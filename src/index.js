import 'dotenv/config';
import { createServer } from 'http';
import mongoose from 'mongoose';
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

if (process.env.MONGODB_URI) {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

const bot = createBot(token, steamApiKey);
startScheduler(bot.telegram, steamApiKey);

// Optional: listen on PORT for Render.com Web Service (health check)
const port = process.env.PORT;
if (port) {
  createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
  }).listen(port, () => console.log(`Listening on port ${port}`));
}

bot.launch().then(() => {
  console.log('Bot started');
}).catch((err) => {
  console.error('Bot launch failed:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
