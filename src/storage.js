import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE_PATH = join(DATA_DIR, 'linked-users.json');

const TAG_MAX_LENGTH = 16;

/**
 * @typedef {Object} LinkedUser
 * @property {number} telegramUserId
 * @property {number} chatId
 * @property {string} steamId64
 * @property {string} [lastTag] - last set tag for deduplication
 */

/**
 * @returns {Promise<LinkedUser[]>}
 */
async function load() {
  try {
    const data = await readFile(FILE_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * @param {LinkedUser[]} users
 */
async function save(users) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE_PATH, JSON.stringify(users, null, 2), 'utf-8');
}

/**
 * @param {number} telegramUserId
 * @param {number} chatId
 * @param {string} steamId64
 */
export async function add(telegramUserId, chatId, steamId64) {
  const users = await load();
  const existing = users.findIndex(
    (u) => u.telegramUserId === telegramUserId && u.chatId === chatId
  );
  const record = { telegramUserId, chatId, steamId64 };
  if (existing >= 0) {
    users[existing] = record;
  } else {
    users.push(record);
  }
  await save(users);
}

/**
 * @param {number} telegramUserId
 * @param {number} [chatId] - if omitted, remove from all chats
 */
export async function remove(telegramUserId, chatId) {
  const users = await load();
  const filtered = chatId
    ? users.filter((u) => !(u.telegramUserId === telegramUserId && u.chatId === chatId))
    : users.filter((u) => u.telegramUserId !== telegramUserId);
  await save(filtered);
}

/**
 * @returns {Promise<LinkedUser[]>}
 */
export async function getAll() {
  return load();
}

/**
 * @param {number} telegramUserId
 * @param {number} chatId
 * @returns {Promise<LinkedUser|null>}
 */
export async function get(telegramUserId, chatId) {
  const users = await load();
  return users.find((u) => u.telegramUserId === telegramUserId && u.chatId === chatId) ?? null;
}

/**
 * Truncate tag to Telegram limit (0-16 chars, no emoji).
 * @param {string} tag
 * @returns {string}
 */
export function truncateTag(tag) {
  if (!tag || typeof tag !== 'string') return '';
  return tag.replace(/\p{Emoji}/gu, '').slice(0, TAG_MAX_LENGTH).trim();
}

/**
 * Update lastTag for a user (for scheduler deduplication).
 * @param {number} telegramUserId
 * @param {number} chatId
 * @param {string} tag
 */
export async function setLastTag(telegramUserId, chatId, tag) {
  const users = await load();
  const u = users.find((x) => x.telegramUserId === telegramUserId && x.chatId === chatId);
  if (u) {
    u.lastTag = tag;
    await save(users);
  }
}
