import Anthropic from '@anthropic-ai/sdk';
import { config, thinkingForModel } from './config.js';

export class LLMUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LLMUnavailableError';
  }
}

export class LLMRefusalError extends Error {
  constructor(category, explanation) {
    super(`Claude refused${category ? ` (${category})` : ''}: ${explanation || 'no explanation given'}`);
    this.name = 'LLMRefusalError';
    this.category = category || null;
    this.explanation = explanation || '';
  }
}

const client = new Anthropic({
  apiKey: config.anthropicApiKey,
  maxRetries: 3,
  timeout: 120_000,
  ...(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}),
});

function isUnavailable(err) {
  if (!err) return false;
  if (err.status === 429 || err.status === 529) return true;
  if (typeof err.status === 'number' && err.status >= 500) return true;
  if (err.name === 'APIConnectionError' || err.name === 'APIConnectionTimeoutError') return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('overloaded') ||
    msg.includes('connection error') ||
    msg.includes('timed out') ||
    msg.includes('fetch failed')
  );
}

async function createMessage(params) {
  try {
    return await client.messages.create(params);
  } catch (err) {
    if (isUnavailable(err)) {
      throw new LLMUnavailableError(err.message || 'service unavailable');
    }
    throw err;
  }
}

function extractText(message) {
  return (message?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function assertNotRefusal(message) {
  if (message?.stop_reason === 'refusal') {
    const details = message.stop_details || {};
    throw new LLMRefusalError(details.category, details.explanation);
  }
}

function buildThinking(model) {
  // Anthropic rejects `thinking: undefined` less gracefully than a missing key,
  // so only attach it when we actually have a config for this model.
  return thinkingForModel(model, config.anthropicThinking);
}

/**
 * Free-form chat reply. Returns the model's text as-is: formatting is handled by
 * format.js when the message is sent.
 */
export async function generateReply({ systemInstruction, messages }) {
  const params = {
    model: config.anthropicModel,
    max_tokens: config.anthropicMaxTokens,
    system: systemInstruction,
    messages,
    output_config: { effort: config.anthropicEffort },
  };
  const thinking = buildThinking(config.anthropicModel);
  if (thinking) params.thinking = thinking;

  const message = await createMessage(params);
  assertNotRefusal(message);

  const text = extractText(message);
  if (!text) {
    throw new Error(
      `Empty response from Claude (stop=${message.stop_reason}, output=${message.usage?.output_tokens ?? '?'})`
    );
  }
  if (message.stop_reason === 'max_tokens') {
    console.warn('[llm] reply hit max_tokens; the answer is likely truncated');
  }
  return text;
}

/**
 * Structured JSON call. The schema is enforced by the API — the returned object
 * is guaranteed to parse, so callers don't need their own JSON repair logic.
 */
export async function generateJSON({ systemInstruction, prompt, schema, maxTokens }) {
  const model = config.anthropicUtilityModel;
  const params = {
    model,
    max_tokens: maxTokens ?? config.anthropicUtilityMaxTokens,
    system: systemInstruction,
    messages: [{ role: 'user', content: prompt }],
    output_config: {
      effort: config.anthropicUtilityEffort,
      format: { type: 'json_schema', schema },
    },
  };
  const thinking = buildThinking(model);
  if (thinking) params.thinking = thinking;

  const message = await createMessage(params);
  assertNotRefusal(message);

  if (message.stop_reason === 'max_tokens') {
    throw new Error('Structured output was truncated at max_tokens; raise ANTHROPIC_UTILITY_MAX_TOKENS');
  }

  const text = extractText(message);
  if (!text) {
    throw new Error(`Empty structured response from Claude (stop=${message.stop_reason})`);
  }
  return JSON.parse(text);
}
