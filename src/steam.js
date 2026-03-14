import axios from 'axios';

const STEAM_BASE = 'https://api.steampowered.com';

/**
 * Resolve vanity URL to 64-bit Steam ID.
 * @param {string} apiKey
 * @param {string} vanityUrl
 * @returns {Promise<string|null>} steamId64 or null if not found
 */
export async function resolveVanityUrl(apiKey, vanityUrl) {
  const { data } = await axios.get(
    `${STEAM_BASE}/ISteamUser/ResolveVanityURL/v1/`,
    { params: { key: apiKey, vanityurl: vanityUrl } }
  );
  const id = data?.response?.steamid;
  return id || null;
}

/**
 * Normalize input to 64-bit Steam ID (string).
 * If input looks like a number (only digits), treat as steamId64.
 * Otherwise treat as vanity URL and resolve.
 * @param {string} apiKey
 * @param {string} input
 * @returns {Promise<string|null>}
 */
export async function toSteamId64(apiKey, input) {
  const trimmed = String(input).trim();
  if (/^\d{17}$/.test(trimmed)) return trimmed;
  return resolveVanityUrl(apiKey, trimmed);
}

/**
 * @typedef {Object} PlayerSummary
 * @property {string} [gameid]
 * @property {string} [gameextrainfo]
 */

/**
 * Get player summaries (including current game if playing).
 * @param {string} apiKey
 * @param {string[]} steamIds64
 * @returns {Promise<Map<string, PlayerSummary>>} steamId64 -> summary
 */
export async function getPlayerSummaries(apiKey, steamIds64) {
  if (!steamIds64.length) return new Map();
  const { data } = await axios.get(
    `${STEAM_BASE}/ISteamUser/GetPlayerSummaries/v2/`,
    { params: { key: apiKey, steamids: steamIds64.join(',') } }
  );
  const list = data?.response?.players ?? [];
  const map = new Map();
  for (const p of list) {
    const id = p.steamid;
    if (id) {
      map.set(id, {
        gameid: p.gameid,
        gameextrainfo: p.gameextrainfo,
      });
    }
  }
  return map;
}

/**
 * Get current game name for one player.
 * @param {string} apiKey
 * @param {string} steamId64
 * @returns {Promise<{ gameName: string | null, error?: string }>}
 */
export async function getCurrentGame(apiKey, steamId64) {
  try {
    const summaries = await getPlayerSummaries(apiKey, [steamId64]);
    const summary = summaries.get(steamId64);
    if (!summary) {
      return { gameName: null, error: 'Profile not found or private.' };
    }
    const name = summary.gameextrainfo || null;
    return { gameName: name };
  } catch (err) {
    const message = err.response?.data?.message ?? err.message ?? 'Steam API error';
    return { gameName: null, error: String(message) };
  }
}
