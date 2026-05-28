import { Telegraf } from 'telegraf';
import { config } from './config.js';
import * as storage from './storage.js';
import * as llm from './llm.js';
import * as prompts from './prompts.js';

const EMOJI_RE = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu;

const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const chatCooldown = new Map();

function isInCooldown(chatId) {
  const state = chatCooldown.get(chatId);
  if (!state) return false;
  if (Date.now() >= state.until) {
    chatCooldown.delete(chatId);
    return false;
  }
  return true;
}

function markCooldownReturnShouldNotify(chatId) {
  const existing = chatCooldown.get(chatId);
  const alreadyNotified = existing?.notified === true && Date.now() < existing.until;
  chatCooldown.set(chatId, {
    until: Date.now() + RATE_LIMIT_COOLDOWN_MS,
    notified: true,
  });
  return !alreadyNotified;
}

function clearCooldown(chatId) {
  chatCooldown.delete(chatId);
}

function isBotAddressed(message, botInfo) {
  if (!message || !botInfo) return false;
  if (message.reply_to_message?.from?.id === botInfo.id) return true;
  const entities = message.entities || [];
  const text = message.text || '';
  const username = botInfo.username ? botInfo.username.toLowerCase() : '';
  for (const e of entities) {
    if (e.type === 'mention' && username) {
      const slice = text.substring(e.offset, e.offset + e.length).toLowerCase();
      if (slice === '@' + username) return true;
    }
    if (e.type === 'text_mention' && e.user?.id === botInfo.id) return true;
  }
  return false;
}

function shouldSkip(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('/')) return true;
  const significant = trimmed.replace(EMOJI_RE, '').replace(/\s+/g, '');
  return significant.length <= 1;
}

function displayName(from) {
  if (!from) return 'Unknown';
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  if (from.username) return '@' + from.username;
  return 'User' + from.id;
}

function cleanBotResponse(text) {
  if (!text) return '';
  let t = text.trim();
  // Strip leading "Name:" prefix if model accidentally added one
  // (matches Latin/Cyrillic word + optional spaces + ":" + space at the start)
  t = t.replace(/^[A-Za-zА-Яа-яЁё][\wА-Яа-яЁё\-]{0,30}\s*:\s*/, '');
  // Strip leading parenthetical "actions" reasoning models love to add: "(Хмыкнул)", "(Спокойно зыркает...)"
  t = t.replace(/^\(\s*[^)]{1,100}\s*\)\s*/, '');
  // Strip leading <think>...</think> blocks some reasoning models leak through
  t = t.replace(/^<think>[\s\S]*?<\/think>\s*/i, '');
  // Strip leading italics-as-action: "*вздыхает*" at the start
  t = t.replace(/^\*[^*\n]{1,80}\*\s*/, '');
  // Strip leading quotes that sometimes wrap the response
  t = t.replace(/^[«"']+\s*/, '').replace(/\s*[»"']+$/, '');
  return t.trim();
}

function buildMessages(history) {
  const turns = history.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.role === 'assistant' ? m.text : `${m.displayName}: ${m.text}`,
  }));

  const merged = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) {
      last.content += '\n' + t.content;
    } else {
      merged.push({ ...t });
    }
  }

  while (merged.length > 0 && merged[0].role !== 'user') merged.shift();
  while (merged.length > 0 && merged[merged.length - 1].role !== 'user') merged.pop();

  return merged;
}

export function createBot() {
  const bot = new Telegraf(config.telegramBotToken);

  bot.on('text', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;

    const from = ctx.from;
    if (!from || from.is_bot) return;

    const text = ctx.message?.text;
    if (shouldSkip(text)) return;

    const chatId = chat.id;
    const userId = from.id;
    const name = displayName(from);

    console.log(
      `[pid=${process.pid}] msg update=${ctx.update?.update_id} msg_id=${ctx.message?.message_id} chat=${chatId} from=${name}: "${(text || '').slice(0, 60)}"`
    );

    try {
      await storage.appendChatMessage({
        chatId,
        telegramUserId: userId,
        displayName: name,
        role: 'user',
        text,
      });
    } catch (err) {
      console.error('Failed to save incoming message:', err.message);
      return;
    }

    if (!isBotAddressed(ctx.message, ctx.botInfo)) return;

    if (isInCooldown(chatId)) return;

    let history;
    let userFacts;
    try {
      [history, userFacts] = await Promise.all([
        storage.getRecentChatMessages(chatId, config.contextWindow),
        storage.getChatUserFacts(chatId),
      ]);
    } catch (err) {
      console.error('Failed to load context:', err.message);
      return;
    }

    const messages = buildMessages(history);
    if (messages.length === 0) return;

    const persona = prompts.buildPersonaPrompt(userFacts);

    try {
      ctx.sendChatAction('typing').catch(() => {});
    } catch (_) {
      // ignore
    }

    let response;
    try {
      response = await llm.generateReply({ systemInstruction: persona, messages });
    } catch (err) {
      if (err instanceof llm.LLMUnavailableError) {
        const shouldNotify = markCooldownReturnShouldNotify(chatId);
        if (shouldNotify) {
          try {
            await ctx.reply(prompts.pickRateLimitPhrase(), { disable_notification: true });
          } catch (replyErr) {
            console.error('Failed to send rate-limit phrase:', replyErr.message);
          }
        }
        return;
      }
      console.error('LLM generateReply failed:', err.message);
      return;
    }

    clearCooldown(chatId);

    const cleaned = cleanBotResponse(response);
    if (!cleaned || cleaned.length < 2) {
      console.warn(`LLM returned too-short response (raw="${response}", cleaned="${cleaned}") — skipping`);
      return;
    }

    try {
      await ctx.reply(cleaned, { disable_notification: true });
    } catch (err) {
      console.error('Failed to send reply:', err.message);
      return;
    }

    try {
      await storage.appendChatMessage({
        chatId,
        telegramUserId: ctx.botInfo?.id ?? 0,
        displayName: config.botName,
        role: 'assistant',
        text: cleaned,
      });
    } catch (err) {
      console.error('Failed to save bot reply:', err.message);
    }
  });

  bot.catch((err) => {
    console.error('Telegraf error:', err);
  });

  return bot;
}
