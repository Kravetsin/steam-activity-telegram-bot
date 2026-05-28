import 'dotenv/config';

const env = process.env;

function intOrDefault(value, fallback) {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export const config = {
  telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',
  llmApiKey: env.LLM_API_KEY || '',
  llmBaseUrl: (env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
  llmModel: env.LLM_MODEL || 'llama-3.3-70b-versatile',
  mongodbUri: env.MONGODB_URI || '',
  botName: env.BOT_NAME || 'Бот',
  dailyResetHour: Math.min(23, Math.max(0, intOrDefault(env.DAILY_RESET_HOUR, 4))),
  contextWindow: Math.min(200, Math.max(5, intOrDefault(env.CONTEXT_WINDOW, 25))),
  port: env.PORT ? Number(env.PORT) : null,
  webhookDomain: (env.WEBHOOK_DOMAIN || '').replace(/\/$/, ''),
  dnsServers: env.DNS_SERVERS
    ? env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
};

export function validateConfig() {
  const missing = [];
  if (!config.telegramBotToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.llmApiKey) missing.push('LLM_API_KEY');
  if (!config.mongodbUri) missing.push('MONGODB_URI');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
}
