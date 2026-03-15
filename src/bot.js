import { Telegraf } from 'telegraf';
import * as storage from './storage.js';
import * as steam from './steam.js';

const TAG_MAX_LENGTH = 16;
const DEFAULT_TAG_OFFLINE = 'Не в игре';

/**
 * @param {string} token
 * @param {string} steamApiKey
 * @returns {import('telegraf').Telegraf}
 */
export function createBot(token, steamApiKey) {
  const bot = new Telegraf(token);

  bot.command('link', async (ctx) => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (!chatId || !userId) return;

    const args = ctx.message.text.split(/\s+/).slice(1);
    const input = args[0];
    if (!input) {
      await ctx.reply(
        'Использование: /link <Steam ID или vanity>\nПример: /link 76561198000000000 или /link myusername'
      );
      return;
    }

    if (ctx.chat.type !== 'supergroup' && ctx.chat.type !== 'group') {
      await ctx.reply('Привязка Steam ID возможна только в группах и супергруппах.');
      return;
    }

    try {
      const steamId64 = await steam.toSteamId64(steamApiKey, input);
      if (!steamId64) {
        await ctx.reply('Не удалось найти Steam ID. Проверьте введённые данные (64-bit ID или custom URL).');
        return;
      }

      const { gameName, error } = await steam.getCurrentGame(steamApiKey, steamId64);
      if (error && !gameName) {
        await ctx.reply(
          `Steam ID привязан, но сейчас не удалось получить статус игры (профиль может быть закрыт): ${steamId64}`
        );
      }

      await storage.add(userId, chatId, steamId64);
      const tag = gameName
        ? storage.truncateTag(gameName)
        : DEFAULT_TAG_OFFLINE;
      await setUserTag(ctx.telegram, chatId, userId, tag);
      await ctx.reply(`Steam ID привязан: ${steamId64}. Тег обновлён.`);
    } catch (err) {
      console.error('link error', err);
      await ctx.reply('Ошибка при привязке. Попробуйте позже или проверьте Steam ID.');
    }
  });

  bot.command('unlink', async (ctx) => {
    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      if (chatId) {
        await storage.remove(userId, chatId);
      } else {
        await storage.remove(userId);
      }
      await ctx.reply('Steam ID отвязан.');
    } catch (err) {
      console.error('unlink error', err);
      await ctx.reply('Ошибка при отвязке.');
    }
  });

  bot.command('ping', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (ctx.chat.type !== 'supergroup' && ctx.chat.type !== 'group') {
      await ctx.reply('Команда /ping доступна только в группах и супергруппах.');
      return;
    }

    try {
      const linked = await storage.getByChatId(chatId);
      if (!linked.length) {
        await ctx.reply('В этом чате пока никто не привязал Steam. Используйте /link.');
        return;
      }
      const mentions = await Promise.all(
        linked.map(async (u) => {
          let label = '·';
          try {
            const member = await ctx.telegram.getChatMember(chatId, u.telegramUserId);
            const user = member?.user;
            if (user) {
              const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
              label = name || (user.username ? `@${user.username}` : '·');
            }
          } catch (_) {
            // user may have left the chat
          }
          const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<a href="tg://user?id=${u.telegramUserId}">${escaped}</a>`;
        })
      );
      await ctx.reply(`Общий сбор: ${mentions.join(' ')}`, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('ping error', err);
      await ctx.reply('Ошибка при выполнении /ping.');
    }
  });

  return bot;
}

/**
 * Set tag for a user: custom title for admins/creator, member tag for regular members.
 * @param {import('telegraf').Telegram} telegram
 * @param {number} chatId
 * @param {number} userId
 * @param {string} tag - 0-16 chars, no emoji
 */
export async function setUserTag(telegram, chatId, userId, tag) {
  const t = tag.slice(0, TAG_MAX_LENGTH).trim();
  if (!telegram.callApi) return;
  try {
    const member = await telegram.callApi('getChatMember', {
      chat_id: chatId,
      user_id: userId,
    });
    const status = member?.status;
    if (status === 'creator' || status === 'administrator') {
      try {
        await telegram.callApi('setChatAdministratorCustomTitle', {
          chat_id: chatId,
          user_id: userId,
          custom_title: t || ' ',
        });
      } catch (err) {
        console.warn(
          `setChatAdministratorCustomTitle failed for ${userId} in ${chatId}:`,
          err.response?.description ?? err.message
        );
      }
      return;
    }
    await setMemberTag(telegram, chatId, userId, tag);
  } catch (err) {
    console.warn(
      `setUserTag failed for ${userId} in ${chatId}:`,
      err.response?.description ?? err.message
    );
  }
}

/**
 * Set member tag via Bot API (requires can_manage_tags). Used for regular members only.
 * @param {import('telegraf').Telegram} telegram
 * @param {number} chatId
 * @param {number} userId
 * @param {string} tag - 0-16 chars, no emoji
 */
async function setMemberTag(telegram, chatId, userId, tag) {
  const t = tag.slice(0, TAG_MAX_LENGTH).trim();
  try {
    if (telegram.callApi) {
      await telegram.callApi('setChatMemberTag', {
        chat_id: chatId,
        user_id: userId,
        tag: t || undefined,
      });
    }
  } catch (err) {
    if (err.response?.description?.includes('can_manage_tags') || err.response?.error_code === 400) {
      console.warn(`setChatMemberTag not available for chat ${chatId}:`, err.response?.description);
    } else {
      throw err;
    }
  }
}
