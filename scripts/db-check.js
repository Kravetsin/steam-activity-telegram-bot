// Round-trips the storage layer against the configured database, then removes everything
// it created. Safe against a live database: it only uses a synthetic chat id that
// Telegram will never hand out.
//
//   npm run db:check
import { connect, close, pool } from '../src/db.js';
import * as storage from '../src/storage.js';

const CHAT_ID = -987654321012;
const USER_ID = 123456789;

const results = [];
function check(label, ok) {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
}

async function cleanup() {
  await pool.query('DELETE FROM chat_messages WHERE chat_id = $1', [CHAT_ID]);
  await pool.query('DELETE FROM user_facts WHERE chat_id = $1', [CHAT_ID]);
}

await connect();
console.log('Postgres connected, schema ready\n');

try {
  await cleanup();

  // ── messages ──
  await storage.appendChatMessage({ chatId: CHAT_ID, telegramUserId: USER_ID, displayName: 'Тест', role: 'user', text: 'first' });
  await storage.appendChatMessage({ chatId: CHAT_ID, telegramUserId: USER_ID, displayName: 'Тест', role: 'assistant', text: 'second' });
  await storage.appendChatMessage({ chatId: CHAT_ID, telegramUserId: USER_ID, displayName: 'Тест', role: 'user', text: 'third' });

  const recent = await storage.getRecentChatMessages(CHAT_ID, 2);
  check('limit is respected', recent.length === 2);
  check('oldest of the window comes first', recent[0].text === 'second' && recent[1].text === 'third');
  check('bigint chatId comes back as a number', typeof recent[0].chatId === 'number' && recent[0].chatId === CHAT_ID);
  check('ts comes back as a Date', recent[0].ts instanceof Date);
  check('camelCase aliases survive', recent[0].displayName === 'Тест' && typeof recent[0].telegramUserId === 'number');

  const chatIds = await storage.getChatIdsWithMessages();
  check('chat id list includes the chat', chatIds.includes(CHAT_ID));

  const upTo = await storage.getMessagesUpTo(CHAT_ID, new Date(Date.now() + 60_000));
  check('getMessagesUpTo returns the full history', upTo.length === 3);

  // ── facts ──
  await storage.appendUserFacts({
    chatId: CHAT_ID,
    telegramUserId: USER_ID,
    displayName: 'Ihor',
    newFacts: ['любит кофе', 'любит кофе', '  живёт в Киеве  '],
  });
  let row = (await storage.getChatUserFacts(CHAT_ID))[0];
  check('facts are trimmed and deduplicated', row.facts.length === 2 && row.facts.includes('живёт в Киеве'));
  check('facts keep the display name', row.displayName === 'Ihor');

  const many = Array.from({ length: 60 }, (_, i) => `факт ${i}`);
  await storage.appendUserFacts({ chatId: CHAT_ID, telegramUserId: USER_ID, displayName: 'Ihor', newFacts: many });
  row = (await storage.getChatUserFacts(CHAT_ID))[0];
  check('facts capped at 50', row.facts.length === 50);
  check('cap drops the oldest first', row.facts[0] === 'факт 10' && row.facts.at(-1) === 'факт 59');

  // ── cleanup path used by the daily scheduler ──
  await storage.deleteMessagesUpTo(CHAT_ID, new Date(Date.now() + 60_000));
  check('deleteMessagesUpTo removes the window', (await storage.getRecentChatMessages(CHAT_ID, 10)).length === 0);
} finally {
  await cleanup();
  await close();
}

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall ${results.length} checks passed`);
