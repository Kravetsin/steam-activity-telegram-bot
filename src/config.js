import 'dotenv/config';

const env = process.env;

function intOrDefault(value, fallback) {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export const config = {
  telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
  geminiApiKey: env.GEMINI_API_KEY || '',
  mongodbUri: env.MONGODB_URI || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
  botName: env.BOT_NAME || 'Бот',
  dailyResetHour: Math.min(23, Math.max(0, intOrDefault(env.DAILY_RESET_HOUR, 4))),
  contextWindow: Math.min(200, Math.max(5, intOrDefault(env.CONTEXT_WINDOW, 25))),
  port: env.PORT ? Number(env.PORT) : null,
  dnsServers: env.DNS_SERVERS
    ? env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
};

export function validateConfig() {
  const missing = [];
  if (!config.telegramBotToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.geminiApiKey) missing.push('GEMINI_API_KEY');
  if (!config.mongodbUri) missing.push('MONGODB_URI');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
