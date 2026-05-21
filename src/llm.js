import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export class LLMUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LLMUnavailableError';
  }
}

function isRateLimit(err) {
  if (!err) return false;
  if (err.status === 429 || err.code === 429) return true;
  const msg = String(err.message || err).toLowerCase();
  return (
    msg.includes('"code":429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests')
  );
}

function isTransient(err) {
  if (!err) return false;
  if (err.status === 503 || err.code === 503 || err.status === 500) return true;
  const msg = String(err.message || err).toLowerCase();
  return (
    msg.includes('"code":503') ||
    msg.includes('"code":500') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('internal error')
  );
}

async function callWithRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (isTransient(err)) {
      await new Promise((r) => setTimeout(r, 1500));
      return fn();
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

export async function generateReply({ systemInstruction, contents }) {
  try {
    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: config.geminiModel,
        contents,
        config: {
          systemInstruction,
          temperature: 0.9,
          maxOutputTokens: 400,
          tools: [{ googleSearch: {} }],
        },
      })
    );
    const text = response.text;
    if (!text || !text.trim()) {
      throw new Error('Empty response from Gemini');
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
    const response = await callWithRetry(() =>
      ai.models.generateContent({
        model: config.geminiModel,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction,
          temperature: 0.3,
          responseMimeType: 'application/json',
          maxOutputTokens: 2000,
        },
      })
    );
    const text = response.text;
    if (!text || !text.trim()) {
      throw new Error('Empty response from Gemini fact extraction');
    }
    return JSON.parse(text);
  } catch (err) {
    if (isRateLimit(err) || isTransient(err)) {
      throw new LLMUnavailableError(err.message || 'service unavailable');
    }
    throw err;
  }
}
