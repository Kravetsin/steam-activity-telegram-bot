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
        },
      })
    );
    const text = response.text;
    if (!text || !text.trim()) {
      throw new Error('Empty response from Gemini');
    }
    return text.trim();
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
