import { config } from './config.js';
import * as storage from './storage.js';
import * as llm from './llm.js';
import * as prompts from './prompts.js';

function msUntilNextRun(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function extractFactsForChat(chatId) {
  const cutoffTs = new Date();
  const messages = await storage.getMessagesUpTo(chatId, cutoffTs);
  if (!messages.length) return;

  const existingFacts = await storage.getChatUserFacts(chatId);

  let result;
  try {
    result = await llm.extractFacts({
      systemInstruction: prompts.getFactExtractionSystem(),
      prompt: prompts.buildFactExtractionPrompt({ existingFacts, messages }),
    });
  } catch (err) {
    if (err instanceof llm.LLMUnavailableError) {
      console.warn(`[scheduler] Fact extraction unavailable for chat ${chatId} (rate-limited or overloaded) — will retry next cycle`);
    } else {
      console.error(`[scheduler] Fact extraction failed for chat ${chatId}:`, err.message);
    }
    return;
  }

  if (!result || !Array.isArray(result.users)) {
    console.warn(`[scheduler] Unexpected extraction result for chat ${chatId}:`, result);
    return;
  }

  const nameByUser = new Map();
  for (const m of messages) {
    if (m.role === 'user' && m.displayName) nameByUser.set(m.telegramUserId, m.displayName);
  }

  for (const entry of result.users) {
    if (!entry || typeof entry.telegramUserId !== 'number') continue;
    if (!Array.isArray(entry.newFacts) || entry.newFacts.length === 0) continue;
    const name = nameByUser.get(entry.telegramUserId) || 'Unknown';
    try {
      await storage.appendUserFacts({
        chatId,
        telegramUserId: entry.telegramUserId,
        displayName: name,
        newFacts: entry.newFacts,
      });
    } catch (err) {
      console.error(`[scheduler] Failed to save facts for user ${entry.telegramUserId} in chat ${chatId}:`, err.message);
    }
  }

  try {
    await storage.deleteMessagesUpTo(chatId, cutoffTs);
  } catch (err) {
    console.error(`[scheduler] Failed to delete messages for chat ${chatId}:`, err.message);
  }
}

async function runDailyExtraction() {
  console.log('[scheduler] Daily extraction starting…');
  let chatIds;
  try {
    chatIds = await storage.getChatIdsWithMessages();
  } catch (err) {
    console.error('[scheduler] Failed to enumerate chats:', err.message);
    return;
  }

  for (const chatId of chatIds) {
    try {
      await extractFactsForChat(chatId);
    } catch (err) {
      console.error(`[scheduler] extractFactsForChat crashed for chat ${chatId}:`, err);
    }
  }
  console.log(`[scheduler] Daily extraction completed (chats processed: ${chatIds.length})`);
}

let timeoutHandle = null;

export function startScheduler() {
  function schedule() {
    const ms = msUntilNextRun(config.dailyResetHour);
    const hours = (ms / 3600000).toFixed(1);
    console.log(`[scheduler] Next daily extraction in ${hours}h (at ${config.dailyResetHour}:00 local)`);
    timeoutHandle = setTimeout(async () => {
      await runDailyExtraction();
      schedule();
    }, ms);
  }
  schedule();
}

export function stopScheduler() {
  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
    timeoutHandle = null;
  }
}
