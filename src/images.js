import * as llm from './llm.js';

const POLLINATIONS = 'https://image.pollinations.ai/prompt';

// Light fallback style — used only if LLM translation fails. With LLM translation working,
// the model picks subject-appropriate style itself (photo for objects, painting for scenes).
const FALLBACK_STYLE_SUFFIX = ', detailed, 4k, sharp focus';

// Geralt-flavored captions sent with the image. Random pick.
const CAPTIONS = [
  'Хмм. Смотри что вышло.',
  'Угу. Готово.',
  'Вот. Не благодари.',
  'Чёрт. Не моё ремесло, но держи.',
  'Готово. В следующий раз сам нарисуй.',
  'Угу. Не Микеланджело, но сойдёт.',
  'Хмм. Лучше чем я ожидал.',
];

/**
 * Build a Pollinations.ai image URL for a given prompt.
 * Pollinations generates on-demand when Telegram fetches this URL.
 *
 * @param {string} prompt - positive prompt (already English, LLM-translated, or raw fallback)
 * @param {object} [options]
 * @param {string} [options.negativePrompt] - what to avoid in the image
 * @param {boolean} [options.alreadyEnriched] - if true, skip the fallback style suffix
 */
export function buildImageUrl(prompt, options = {}) {
  const {
    width = 1024,
    height = 1024,
    model = 'flux',
    seed,
    negativePrompt = '',
    alreadyEnriched = false,
  } = options;
  const fullPrompt = alreadyEnriched ? prompt : `${prompt}${FALLBACK_STYLE_SUFFIX}`;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: 'true',
    private: 'true',
  });
  // enhance=true only when we did NOT use LLM translation — otherwise Pollinations
  // re-rewrites our carefully-crafted English prompt and ruins specifics.
  if (!alreadyEnriched) params.set('enhance', 'true');
  if (negativePrompt) params.set('negative_prompt', negativePrompt);
  if (seed !== undefined) params.set('seed', String(seed));
  return `${POLLINATIONS}/${encodeURIComponent(fullPrompt)}?${params.toString()}`;
}

const TRANSLATION_SYSTEM = `Ты переводишь короткие описания пользователя (обычно на русском) в детальные английские промпты для FLUX — image generation модели.

Правила:
1. Переводи СМЫСЛ, не слова. «Какашка» → "pile of brown poop", не cat. «Бабка с мечом» → "old woman wielding a sword".
2. Добавляй детали стиля исходя из предмета:
   - Бытовые объекты, еда, предметы: "realistic photo, daylight, natural lighting, sharp focus, 4k"
   - Персонажи, существа, фэнтези-сцены: "highly detailed digital painting, dramatic cinematic lighting, atmospheric, fantasy art"
   - Портреты людей/животных: "portrait, professional photography, soft lighting, bokeh, detailed"
   - Пейзажи: "landscape photography, golden hour, wide shot, vibrant colors"
   - Мемы / гротеск / абсурд: "internet meme, lowbrow art, exaggerated, funny"
3. Если пользователь хочет ОТСУТСТВИЕ чего-то («без глаз», «без фона», «not blue»), вытащи это в negative_prompt. Не упоминай в positive prompt — это только усиливает!
4. Не вставляй имена реальных знаменитостей или политических деятелей.
5. Сохраняй пользовательский интент. Если он попросил абсурд — рисуй абсурд, не «исправляй» в красивое.

Формат ответа — СТРОГО валидный JSON без markdown-обёрток, без пояснений:
{"prompt":"english detailed flux prompt","negative_prompt":"comma separated things to avoid"}

Если в negative_prompt нечего добавить — пустая строка "".`;

function extractJsonObject(text) {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('No JSON object in translation response');
  }
  return JSON.parse(text.substring(first, last + 1));
}

/**
 * Translate a Russian user image-request into a detailed English FLUX prompt
 * with extracted negative_prompt. Falls back to lightly-styled raw prompt on failure.
 */
export async function translateImagePrompt(userPrompt) {
  try {
    const raw = await llm.generateReply({
      systemInstruction: TRANSLATION_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const json = extractJsonObject(raw);
    const prompt = (json.prompt || '').trim();
    const negativePrompt = (json.negative_prompt || '').trim();
    if (!prompt) throw new Error('Empty prompt from translation');
    return { prompt, negativePrompt, translated: true };
  } catch (err) {
    console.warn(`Image prompt translation failed, using raw: ${err.message}`);
    return { prompt: userPrompt, negativePrompt: '', translated: false };
  }
}

export function pickImageCaption() {
  return CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)];
}

/**
 * Detect "нарисуй <prompt>" / "сгенерируй <prompt>" / "draw <prompt>" at the start
 * of a message (after optional @mention). Returns the prompt string or null.
 */
export function detectImageRequest(text) {
  if (!text) return null;
  const m = text.match(
    /^(?:@\S+\s+)?(?:нарисуй(?:те)?|сгенерируй(?:те)?|draw|imagine|сделай\s+картинку)\s+(.+)/i
  );
  return m ? m[1].trim() : null;
}
