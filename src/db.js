import pg from 'pg';
import { config } from './config.js';

// chat_id / telegram_user_id don't fit in int32 (-100… group ids overflow it), so they are
// bigint in the DB. node-postgres hands bigint back as a string by default; Telegram ids are
// far below 2^53, so a plain Number is safe and keeps the rest of the code unchanged.
pg.types.setTypeParser(20, (value) => (value === null ? null : Number(value)));
// timestamptz already maps to a JS Date — left as is.

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id               bigserial PRIMARY KEY,
  chat_id          bigint NOT NULL,
  telegram_user_id bigint NOT NULL,
  display_name     text NOT NULL DEFAULT '',
  role             text NOT NULL CHECK (role IN ('user', 'assistant')),
  text             text NOT NULL,
  ts               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_chat_ts_idx
  ON chat_messages (chat_id, ts);

CREATE TABLE IF NOT EXISTS user_facts (
  chat_id          bigint NOT NULL,
  telegram_user_id bigint NOT NULL,
  display_name     text NOT NULL DEFAULT '',
  facts            text[] NOT NULL DEFAULT '{}',
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, telegram_user_id)
);
`;

/**
 * Verify the connection and make sure the schema exists. Safe to run on every boot:
 * every statement is IF NOT EXISTS.
 */
export async function connect() {
  await pool.query('SELECT 1');
  await pool.query(SCHEMA);
}

export async function close() {
  await pool.end();
}
