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

console.log(`Bot starting as ${config.botName} (pid=${process.pid}, model: ${config.llmModel} @ ${config.llmBaseUrl})`);

async function launchWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await bot.launch({ allowedUpdates: ['message'], dropPendingUpdates: true });
      console.log(`[pid=${process.pid}] Bot polling stopped`);
      return;
    } catch (err) {
      // Defensive cleanup of any partial polling state before retry
      try { bot.stop('retry-cleanup'); } catch (_) {}
      const code = err?.response?.error_code;
      const is409 = code === 409;
      const delaySec = is409 ? 10 : 30;
      console.warn(
        `[pid=${process.pid}] Bot launch attempt ${attempt} failed${is409 ? ' (409 deploy overlap)' : ''}: ${err.message}. Retrying in ${delaySec}s…`
      );
      await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
  }
}

launchWithRetry();
startScheduler();

function shutdown(signal) {
  console.log(`Received ${signal}, shutting down…`);
  stopScheduler();
  bot.stop(signal);
  mongoose.disconnect().catch(() => {});
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
