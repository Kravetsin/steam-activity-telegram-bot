import { config } from './config.js';
import * as storage from './storage.js';
import * as llm from './llm.js';
import * as prompts from './prompts.js';

// Messages are processed in oldest-first batches. A reasoning LLM + a huge prompt
// blows the token budget and produces nothing (empty content → fail → backlog never
// drains). 80 msgs/batch proved safe with max_tokens=8000 (~4.7K reasoning, ~3K headroom).
// Several batches per run cover a normal day's volume and gradually drain any backlog.
const EXTRACTION_BATCH = 80;
const MAX_BATCHES_PER_RUN = 5;

function msUntilNextRun(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// Process one oldest-first batch. Returns:
//   'done'      — nothing left to process
//   'continue'  — a batch was processed and deleted; more may remain
//   'stop'      — extraction failed; keep messages, retry next run
async function extractOneBatch(chatId) {
  const cutoffTs = new Date();
  const all = await storage.getMessagesUpTo(chatId, cutoffTs);
  if (!all.length) return 'done';

  const batch = all.slice(0, EXTRACTION_BATCH); // oldest-first
  const batchCutoff = new Date(batch[batch.length - 1].ts);
  const existingFacts = await storage.getChatUserFacts(chatId);

  let result;
  try {
    result = await llm.extractFacts({
      systemInstruction: prompts.getFactExtractionSystem(),
      prompt: prompts.buildFactExtractionPrompt({ existingFacts, messages: batch }),
    });
  } catch (err) {
    if (err instanceof llm.LLMUnavailableError) {
      // Transient (rate limit / overload) — keep the batch and retry on the next run.
      console.warn(`[scheduler] chat ${chatId}: extraction unavailable (rate-limited/overloaded) — retry next run`);
      return 'stop';
    }
    // Non-transient (model gave bad/malformed output even after internal retries).
    // Sacrifice this batch so a "poison" batch can't block the queue forever.
    console.error(`[scheduler] chat ${chatId}: extraction failed after retries, skipping batch:`, err.message);
    try {
      await storage.deleteMessagesUpTo(chatId, batchCutoff);
    } catch (delErr) {
      console.error(`[scheduler] chat ${chatId}: failed to delete skipped batch:`, delErr.message);
      return 'stop';
    }
    return 'continue';
  }

  if (!result || !Array.isArray(result.users)) {
    console.warn(`[scheduler] chat ${chatId}: unexpected extraction result, skipping batch:`, result);
    try {
      await storage.deleteMessagesUpTo(chatId, batchCutoff);
    } catch (_) {
      return 'stop';
    }
    return 'continue';
  }

  const nameByUser = new Map();
  for (const m of batch) {
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
      console.error(`[scheduler] chat ${chatId}: failed to save facts for ${entry.telegramUserId}:`, err.message);
    }
  }

  try {
    await storage.deleteMessagesUpTo(chatId, batchCutoff);
  } catch (err) {
    console.error(`[scheduler] chat ${chatId}: failed to delete processed batch:`, err.message);
    return 'stop';
  }

  return all.length > batch.length ? 'continue' : 'done';
}

export async function extractFactsForChat(chatId) {
  for (let batch = 1; batch <= MAX_BATCHES_PER_RUN; batch++) {
    const outcome = await extractOneBatch(chatId);
    if (outcome === 'done' || outcome === 'stop') return;
    console.log(`[scheduler] chat ${chatId}: processed batch ${batch}, more remain`);
  }
  console.log(`[scheduler] chat ${chatId}: hit batch cap (${MAX_BATCHES_PER_RUN}); remaining backlog drains next run`);
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
