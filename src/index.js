import 'dotenv/config';
import { createBot } from './bot.js';
import { startScheduler } from './scheduler.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const steamApiKey = process.env.STEAM_API_KEY;

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}
if (!steamApiKey) {
  console.error('STEAM_API_KEY is required');
  process.exit(1);
}

const bot = createBot(token, steamApiKey);
startScheduler(bot.telegram, steamApiKey);

bot.launch().then(() => {
  console.log('Bot started');
}).catch((err) => {
  console.error('Bot launch failed:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
