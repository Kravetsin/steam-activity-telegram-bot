import { config, validateConfig } from '../src/config.js';
import { connect, close } from '../src/db.js';
import { extractFactsForChat } from '../src/scheduler.js';
import * as storage from '../src/storage.js';

try {
  validateConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const arg = process.argv[2];
const requestedChatId = arg === undefined ? null : Number(arg);
if (arg !== undefined && !Number.isFinite(requestedChatId)) {
  console.error(`Invalid chat id: ${arg}`);
  process.exit(1);
}

await connect();
console.log('Postgres connected');

try {
  const chatIds =
    requestedChatId === null
      ? await storage.getChatIdsWithMessages()
      : [requestedChatId];

  if (chatIds.length === 0) {
    console.log('No chats with pending messages.');
  }

  for (const chatId of chatIds) {
    console.log(`[extract] chat ${chatId}…`);
    await extractFactsForChat(chatId);
    console.log(`[extract] chat ${chatId} done`);
  }
} finally {
  await close();
}
