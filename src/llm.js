import { config } from './config.js';

export class LLMUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LLMUnavailableError';
  }
}

function isRateLimit(err) {
  if (!err) return false;
  if (err.status === 429) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('quota');
}

function isTransient(err) {
  if (!err) return false;
  if ([500, 502, 503, 504].includes(err.status)) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('unavailable') || msg.includes('overloaded') || msg.includes('timeout');
}

async function callLLM(payload) {
  const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.llmApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`LLM ${res.status}: ${body.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function callWithRetry(payload) {
  try {
    return await callLLM(payload);
  } catch (err) {
    if (isTransient(err)) {
      await new Promise((r) => setTimeout(r, 1500));
      return callLLM(payload);
    }
    throw err;
  }
}

function stripMarkdown(text) {
  let t = text;
  t = t.replace(/^\s*[*\-+]\s+/gm, '');
  t = t.replace(/^\s*\d+\.\s+/gm, '');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/__(.+?)__/g, '$1');
  t = t.replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1$2');
  t = t.replace(/(^|[^_])_(?!_)([^_\n]+?)_(?!_)/g, '$1$2');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/\[(\d+)\]/g, '');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function stripCodeFence(text) {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function extractJsonObject(text) {
  // Find first { and last } and parse substring — defensive against model adding preamble/postamble
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('No JSON object found in response');
  }
  return JSON.parse(text.substring(first, last + 1));
}

export async function generateReply({ systemInstruction, messages }) {
  try {
    const data = await callWithRetry({
      model: config.llmModel,
      messages: [
        { role: 'system', content: systemInstruction },
        ...messages,
      ],
      temperature: 0.9,
      max_tokens: 8000,
    });
    const text = data?.choices?.[0]?.message?.content;
    if (!text || !text.trim()) {
      // Likely reasoning-model ate all the budget — log usage so we can tune
      const usage = data?.usage;
      const finishReason = data?.choices?.[0]?.finish_reason;
      throw new Error(
        `Empty response from LLM (finish=${finishReason}, completion=${usage?.completion_tokens}, reasoning=${usage?.completion_tokens_details?.reasoning_tokens ?? '?'})`
      );
    }
    return stripMarkdown(text);
  } catch (err) {
    if (isRateLimit(err) || isTransient(err)) {
      throw new LLMUnavailableError(err.message || 'service unavailable');
    }
    throw err;
  }
}

export async function extractFacts({ systemInstruction, prompt }) {
  try {
    const data = await callWithRetry({
      model: config.llmModel,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });
    let text = data?.choices?.[0]?.message?.content;
    if (!text || !text.trim()) {
      throw new Error('Empty response from LLM fact extraction');
    }
    text = stripCodeFence(text);
    try {
      return JSON.parse(text);
    } catch (_) {
      return extractJsonObject(text);
    }
  } catch (err) {
    if (isRateLimit(err) || isTransient(err)) {
      throw new LLMUnavailableError(err.message || 'service unavailable');
    }
    throw err;
  }
}
