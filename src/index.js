import { createServer } from 'http';
import dns from 'dns';
import mongoose from 'mongoose';
import { config, validateConfig } from './config.js';
import { createBot } from './bot.js';
import { startScheduler, stopScheduler } from './scheduler.js';

try {
  validateConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (config.dnsServers.length > 0) {
  dns.setServers(config.dnsServers);
  console.log(`Using custom DNS servers: ${config.dnsServers.join(', ')}`);
}

try {
  await mongoose.connect(config.mongodbUri);
  console.log('MongoDB connected');
} catch (err) {
  console.error('MongoDB connection failed:', err.message);
  process.exit(1);
}

const bot = createBot();

if (config.port) {
  createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
  }).listen(config.port, () => console.log(`Health-check listener on port ${config.port}`));
}

console.log(`Bot starting as ${config.botName} (model: ${config.geminiModel})`);

bot.launch({ allowedUpdates: ['message'], dropPendingUpdates: true }).catch((err) => {
  console.error('Bot launch failed:', err);
  process.exit(1);
});

startScheduler();

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down…`);
  stopScheduler();
  bot.stop(signal);
  mongoose.disconnect().catch(() => {});
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
