import 'dotenv/config';

const env = process.env;

function intOrDefault(value, fallback) {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function oneOf(value, allowed, fallback) {
  const v = String(value || '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

// Telegram user ids are positive; anything unparsable is dropped rather than
// silently becoming 0 or NaN.
function idList(value) {
  return String(value || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const THINKING_MODES = ['auto', 'disabled', 'between_tools', 'adaptive', 'off'];

const thinkingMode = oneOf(env.ANTHROPIC_THINKING, THINKING_MODES, 'auto');

export const config = {
  telegramBotToken: env.TELEGRAM_BOT_TOKEN || '',

  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  // Optional: point the SDK at a proxy / gateway that speaks the Claude API.
  anthropicBaseUrl: (env.ANTHROPIC_BASE_URL || '').replace(/\/$/, ''),
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  // Utility calls (fact extraction, image-prompt translation)
  // don't need the big model. Haiku is ~20x cheaper and fast enough.
  anthropicUtilityModel: env.ANTHROPIC_UTILITY_MODEL || 'claude-haiku-5-5',
  anthropicMaxTokens: Math.max(
    256,
    intOrDefault(env.ANTHROPIC_MAX_TOKENS, thinkingMode === 'adaptive' ? 4096 : 1024)
  ),
  anthropicUtilityMaxTokens: Math.max(256, intOrDefault(env.ANTHROPIC_UTILITY_MAX_TOKENS, 4096)),
  anthropicEffort: oneOf(env.ANTHROPIC_EFFORT, EFFORT_LEVELS, 'low'),
  anthropicUtilityEffort: oneOf(env.ANTHROPIC_UTILITY_EFFORT, EFFORT_LEVELS, 'medium'),
  // auto: pick the right mode for the model (Sonnet 5.5 rejects "disabled").
  anthropicThinking: thinkingMode,

  databaseUrl: env.DATABASE_URL || '',
  botName: env.BOT_NAME || 'Бот',
  // Users allowed to talk to the bot in a private chat. Empty = DMs ignored.
  dmAllowedUserIds: idList(env.TELEGRAM_DM_ALLOWED_IDS),
  dailyResetHour: Math.min(23, Math.max(0, intOrDefault(env.DAILY_RESET_HOUR, 4))),
  contextWindow: Math.min(200, Math.max(5, intOrDefault(env.CONTEXT_WINDOW, 25))),

  port: env.PORT ? Number(env.PORT) : null,
  // Behind Caddy/nginx bind to loopback only. Set HOST=0.0.0.0 if exposing directly.
  host: env.HOST || '127.0.0.1',
  webhookDomain: (env.WEBHOOK_DOMAIN || '').replace(/\/$/, ''),

  dnsServers: env.DNS_SERVERS
    ? env.DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
};

export function validateConfig() {
  const missing = [];
  if (!config.telegramBotToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.anthropicApiKey) missing.push('ANTHROPIC_API_KEY');
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  // "between_tools" (Sonnet 5.5) and "disabled" (Haiku 5.5) only work at high
  // effort or below. Catching it here beats a 400 from the API on every message.
  const thinking = thinkingForModel(config.anthropicModel, config.anthropicThinking);
  const highEfforts = config.anthropicEffort === 'xhigh' || config.anthropicEffort === 'max';
  if (highEfforts && thinking && thinking.type !== 'adaptive') {
    throw new Error(
      `ANTHROPIC_EFFORT=${config.anthropicEffort} requires adaptive thinking; set ANTHROPIC_THINKING=adaptive or lower the effort.`
    );
  }
}

/**
 * Resolve the thinking config for a model. Exported for the smoke test and logs.
 * Returns undefined when the request should omit the field entirely.
 */
export function thinkingForModel(model = config.anthropicModel, mode = config.anthropicThinking) {
  if (mode === 'off') return undefined;
  if (mode !== 'auto') return { type: mode };

  // Sonnet 5.5: "disabled" is a hard 400; "between_tools" is the lowest setting.
  if (/sonnet-5-5/.test(model)) return { type: 'between_tools' };
  // These models accept "disabled" at high effort or below.
  if (/haiku-5-5|haiku-4-5|sonnet-5(?!-5)/.test(model)) return { type: 'disabled' };
  // Opus 5.5 / Fable reject "disabled"; adaptive is always accepted.
  return { type: 'adaptive' };
}
