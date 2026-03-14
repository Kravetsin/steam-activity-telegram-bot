import * as storage from './storage.js';
import * as steam from './steam.js';
import { setUserTag } from './bot.js';

const DEFAULT_TAG_OFFLINE = 'Не в игре';

/**
 * @param {import('telegraf').Telegram} telegram
 * @param {string} steamApiKey
 */
export function startScheduler(telegram, steamApiKey) {
  const intervalMs = Number(process.env.POLL_INTERVAL_MS) || 60_000;

  async function tick() {
    const users = await storage.getAll();
    if (!users.length) return;

    const bySteamId = new Map();
    for (const u of users) {
      if (!bySteamId.has(u.steamId64)) {
        bySteamId.set(u.steamId64, []);
      }
      bySteamId.get(u.steamId64).push(u);
    }

    const steamIds = [...bySteamId.keys()];
    let summaries;
    try {
      summaries = await steam.getPlayerSummaries(steamApiKey, steamIds);
    } catch (err) {
      console.error('Scheduler Steam API error:', err.message);
      return;
    }

    for (const [steamId64, records] of bySteamId) {
      const summary = summaries.get(steamId64);
      const gameName = summary?.gameextrainfo ?? null;
      const tag = gameName
        ? storage.truncateTag(gameName)
        : DEFAULT_TAG_OFFLINE;

      for (const u of records) {
        if (u.lastTag === tag) continue;
        try {
          await setUserTag(telegram, u.chatId, u.telegramUserId, tag);
          await storage.setLastTag(u.telegramUserId, u.chatId, tag);
        } catch (err) {
          console.warn(
            `Failed to set tag for ${u.telegramUserId} in ${u.chatId}:`,
            err.message
          );
        }
      }
    }
  }

  setInterval(tick, intervalMs);
  tick();
}
