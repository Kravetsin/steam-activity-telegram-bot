const POLLINATIONS = 'https://image.pollinations.ai/prompt';

// Style suffix applied to every prompt — pushes FLUX toward atmospheric fantasy art
// Tune freely; this is the lever that most affects vibe.
const STYLE_SUFFIX =
  ', highly detailed digital painting, dramatic cinematic lighting, atmospheric, rich textures, fantasy art, 4k, sharp focus';

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
 */
export function buildImageUrl(userPrompt, options = {}) {
  const { width = 1024, height = 1024, model = 'flux', seed } = options;
  const enriched = `${userPrompt}${STYLE_SUFFIX}`;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model,
    nologo: 'true',
    enhance: 'true',
    private: 'true',
  });
  if (seed !== undefined) params.set('seed', String(seed));
  return `${POLLINATIONS}/${encodeURIComponent(enriched)}?${params.toString()}`;
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
