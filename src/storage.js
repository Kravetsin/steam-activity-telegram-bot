import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import LinkedUser from './models/LinkedUser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE_PATH = join(__dirname, '..', 'data', 'linked-users.json');

const TAG_MAX_LENGTH = 16;
const useMongo = Boolean(process.env.MONGODB_URI);

/**
 * @typedef {Object} LinkedUserType
 * @property {number} telegramUserId
 * @property {number} chatId
 * @property {string} steamId64
 * @property {string} [lastTag] - last set tag for deduplication
 */

/**
 * @returns {Promise<LinkedUserType[]>}
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
 * @param {LinkedUserType[]} users
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
  if (useMongo) {
    await LinkedUser.findOneAndUpdate(
      { telegramUserId, chatId },
      { $set: { steamId64, lastTag: null } },
      { upsert: true, new: true }
    );
    return;
  }
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
  if (useMongo) {
    if (chatId !== undefined && chatId !== null) {
      await LinkedUser.deleteOne({ telegramUserId, chatId });
    } else {
      await LinkedUser.deleteMany({ telegramUserId });
    }
    return;
  }
  const users = await load();
  const filtered =
    chatId !== undefined && chatId !== null
      ? users.filter((u) => !(u.telegramUserId === telegramUserId && u.chatId === chatId))
      : users.filter((u) => u.telegramUserId !== telegramUserId);
  await save(filtered);
}

/**
 * @returns {Promise<LinkedUserType[]>}
 */
export async function getAll() {
  if (useMongo) {
    const docs = await LinkedUser.find({}).lean();
    return docs.map((d) => ({
      telegramUserId: d.telegramUserId,
      chatId: d.chatId,
      steamId64: d.steamId64,
      lastTag: d.lastTag ?? undefined,
    }));
  }
  return load();
}

/**
 * @param {number} telegramUserId
 * @param {number} chatId
 * @returns {Promise<LinkedUserType|null>}
 */
export async function get(telegramUserId, chatId) {
  if (useMongo) {
    const doc = await LinkedUser.findOne({ telegramUserId, chatId }).lean();
    if (!doc) return null;
    return {
      telegramUserId: doc.telegramUserId,
      chatId: doc.chatId,
      steamId64: doc.steamId64,
      lastTag: doc.lastTag ?? undefined,
    };
  }
  const users = await load();
  const u = users.find((x) => x.telegramUserId === telegramUserId && x.chatId === chatId);
  return u ?? null;
}

/**
 * @param {number} chatId
 * @returns {Promise<LinkedUserType[]>}
 */
export async function getByChatId(chatId) {
  if (useMongo) {
    const docs = await LinkedUser.find({ chatId }).lean();
    return docs.map((d) => ({
      telegramUserId: d.telegramUserId,
      chatId: d.chatId,
      steamId64: d.steamId64,
      lastTag: d.lastTag ?? undefined,
    }));
  }
  const users = await load();
  return users.filter((u) => u.chatId === chatId);
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
  if (useMongo) {
    await LinkedUser.updateOne(
      { telegramUserId, chatId },
      { $set: { lastTag: tag } }
    );
    return;
  }
  const users = await load();
  const u = users.find((x) => x.telegramUserId === telegramUserId && x.chatId === chatId);
  if (u) {
    u.lastTag = tag;
    await save(users);
  }
}
