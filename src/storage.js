import ChatMessage from './models/ChatMessage.js';
import UserFact from './models/UserFact.js';
import ChatPersona from './models/ChatPersona.js';

const MAX_FACTS_PER_USER = 50;

export async function getChatPersona(chatId) {
  const doc = await ChatPersona.findOne({ chatId }).lean();
  return doc?.persona || null;
}

export async function setChatPersona(chatId, persona, setByUserId, setByName) {
  await ChatPersona.updateOne(
    { chatId },
    { $set: { persona, setByUserId, setByName, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function clearChatPersona(chatId) {
  await ChatPersona.deleteOne({ chatId });
}

export async function appendChatMessage({ chatId, telegramUserId, displayName, role, text }) {
  await ChatMessage.create({ chatId, telegramUserId, displayName, role, text });
}

export async function getRecentChatMessages(chatId, limit) {
  const docs = await ChatMessage.find({ chatId })
    .sort({ ts: -1 })
    .limit(limit)
    .lean();
  return docs.reverse();
}

export async function getChatIdsWithMessages() {
  return ChatMessage.distinct('chatId');
}

export async function getMessagesUpTo(chatId, cutoffTs) {
  return ChatMessage.find({ chatId, ts: { $lte: cutoffTs } })
    .sort({ ts: 1 })
    .lean();
}

export async function deleteMessagesUpTo(chatId, cutoffTs) {
  await ChatMessage.deleteMany({ chatId, ts: { $lte: cutoffTs } });
}

export async function getChatUserFacts(chatId) {
  return UserFact.find({ chatId }).lean();
}

/**
 * Append new facts to a user's record. Caps total facts at MAX_FACTS_PER_USER (FIFO).
 */
export async function appendUserFacts({ chatId, telegramUserId, displayName, newFacts }) {
  if (!Array.isArray(newFacts) || newFacts.length === 0) return;
  const existing = await UserFact.findOne({ chatId, telegramUserId });
  const facts = existing?.facts ? [...existing.facts] : [];
  for (const f of newFacts) {
    const trimmed = String(f).trim();
    if (trimmed && !facts.includes(trimmed)) facts.push(trimmed);
  }
  while (facts.length > MAX_FACTS_PER_USER) facts.shift();
  await UserFact.updateOne(
    { chatId, telegramUserId },
    { $set: { displayName, facts, updatedAt: new Date() } },
    { upsert: true }
  );
}
