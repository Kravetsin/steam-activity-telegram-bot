import { pool } from './db.js';

const MAX_FACTS_PER_USER = 50;

// Row shape: keep SQL column names aliased to the old camelCase fields, so bot.js /
// scheduler.js / persona.js don't have to change.
const MESSAGE_COLUMNS = `
  chat_id          AS "chatId",
  telegram_user_id AS "telegramUserId",
  display_name     AS "displayName",
  role,
  text,
  ts
`;

export async function getChatPersona(chatId) {
  const { rows } = await pool.query(
    'SELECT persona FROM chat_personas WHERE chat_id = $1',
    [chatId]
  );
  return rows[0]?.persona || null;
}

export async function setChatPersona(chatId, persona, setByUserId, setByName) {
  await pool.query(
    `INSERT INTO chat_personas (chat_id, persona, set_by_user_id, set_by_name, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (chat_id) DO UPDATE SET
       persona        = EXCLUDED.persona,
       set_by_user_id = EXCLUDED.set_by_user_id,
       set_by_name    = EXCLUDED.set_by_name,
       updated_at     = now()`,
    [chatId, persona, setByUserId ?? null, setByName ?? '']
  );
}

export async function clearChatPersona(chatId) {
  await pool.query('DELETE FROM chat_personas WHERE chat_id = $1', [chatId]);
}

export async function appendChatMessage({ chatId, telegramUserId, displayName, role, text }) {
  await pool.query(
    `INSERT INTO chat_messages (chat_id, telegram_user_id, display_name, role, text)
     VALUES ($1, $2, $3, $4, $5)`,
    [chatId, telegramUserId, displayName ?? '', role, text]
  );
}

export async function getRecentChatMessages(chatId, limit) {
  // Newest `limit` rows, then flipped back into chronological order.
  const { rows } = await pool.query(
    `SELECT ${MESSAGE_COLUMNS}
     FROM (
       SELECT * FROM chat_messages
       WHERE chat_id = $1
       ORDER BY ts DESC, id DESC
       LIMIT $2
     ) recent
     ORDER BY ts ASC, id ASC`,
    [chatId, limit]
  );
  return rows;
}

export async function getChatIdsWithMessages() {
  const { rows } = await pool.query(
    'SELECT DISTINCT chat_id AS "chatId" FROM chat_messages ORDER BY 1'
  );
  return rows.map((r) => r.chatId);
}

export async function getMessagesUpTo(chatId, cutoffTs) {
  const { rows } = await pool.query(
    `SELECT ${MESSAGE_COLUMNS}
     FROM chat_messages
     WHERE chat_id = $1 AND ts <= $2
     ORDER BY ts ASC, id ASC`,
    [chatId, cutoffTs]
  );
  return rows;
}

export async function deleteMessagesUpTo(chatId, cutoffTs) {
  await pool.query('DELETE FROM chat_messages WHERE chat_id = $1 AND ts <= $2', [
    chatId,
    cutoffTs,
  ]);
}

export async function getChatUserFacts(chatId) {
  const { rows } = await pool.query(
    `SELECT chat_id          AS "chatId",
            telegram_user_id AS "telegramUserId",
            display_name     AS "displayName",
            facts,
            updated_at       AS "updatedAt"
     FROM user_facts
     WHERE chat_id = $1`,
    [chatId]
  );
  return rows;
}

/**
 * Append new facts to a user's record. Caps total facts at MAX_FACTS_PER_USER (FIFO).
 * Read-modify-write runs in a transaction with a row lock, so two chats finishing their
 * daily extraction at the same moment can't clobber each other's facts.
 */
export async function appendUserFacts({ chatId, telegramUserId, displayName, newFacts }) {
  if (!Array.isArray(newFacts) || newFacts.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT facts FROM user_facts
       WHERE chat_id = $1 AND telegram_user_id = $2
       FOR UPDATE`,
      [chatId, telegramUserId]
    );

    const facts = rows[0]?.facts ? [...rows[0].facts] : [];
    for (const f of newFacts) {
      const trimmed = String(f).trim();
      if (trimmed && !facts.includes(trimmed)) facts.push(trimmed);
    }
    while (facts.length > MAX_FACTS_PER_USER) facts.shift();

    await client.query(
      `INSERT INTO user_facts (chat_id, telegram_user_id, display_name, facts, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (chat_id, telegram_user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         facts        = EXCLUDED.facts,
         updated_at   = now()`,
      [chatId, telegramUserId, displayName ?? '', facts]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
