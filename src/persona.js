import * as llm from './llm.js';

// Cheap reset detection — no LLM call needed.
const RESET_RE =
  /(ста(?:нь|ть)\s+собой|будь\s+собой|вы(?:йди|йти)\s+из\s+роли|хватит\s+(?:отыгрыв|притвор|играть|быть)|перестань\s+(?:быть|отыгрыв|притвор)|сбрось\s+(?:роль|персон)|верни(?:сь)?\s+(?:в\s+)?обычн|отмени\s+роль|стоп\s+роль)/i;

// Cheap gate: does the message look like a "become X" request?
// Only used to decide whether to spend one LLM call on confirmation.
// NOTE: \b is ASCII-only in JS and breaks on Cyrillic, so we use a Cyrillic/Latin
// negative lookbehind for a leading boundary instead.
const SET_RE =
  /(?<![а-яёa-z])(стань|стать|теперь\s+ты|ты\s+теперь|представь,?\s+что\s+ты|притворись|отыгрыв|отыграй|веди\s+себя\s+как|во(?:йди|йти)\s+в\s+роль|вживись|будь\s+(?!собой|проще|добр|мужиком|человеком|честен|готов|внимател))/i;

export function detectReset(text) {
  return RESET_RE.test(text || '');
}

export function looksLikePersonaRequest(text) {
  return SET_RE.test(text || '');
}

const EXTRACT_SYSTEM = `Пользователь в групповом чате, возможно, просит бота стать кем-то / отыгрывать персонажа. Определи, так ли это.

Ответь СТРОГО валидным JSON, без markdown-обёрток и пояснений:
{"isPersonaChange": true/false, "persona": "описание персонажа на русском"}

isPersonaChange = true ТОЛЬКО если пользователь явно просит примерить роль, персонажа или личность: «стань X», «отыгрывай X», «веди себя как X», «теперь ты X», «притворись X».

isPersonaChange = false, если это:
- просто оборот речи («представь, что ты на моём месте», «стань нормальным», «будь проще», «будь мужиком»)
- упрёк, вопрос или обычная реплика
- слишком размыто, чтобы понять, кого играть

Если true — в поле "persona" дай готовую инструкцию для отыгрывания: имя/роль + 1-2 ключевые черты (манера речи, характер). Обогати по своим знаниям персонажа.

Примеры:
вход: "бот, стань Дартом Вейдером" → {"isPersonaChange": true, "persona": "Дарт Вейдер — тёмный лорд ситхов из Star Wars. Дышит через маску, говорит низко, пафосно и угрожающе, поминает Силу и Тёмную сторону, презирает слабость."}
вход: "представь что ты на моём месте" → {"isPersonaChange": false, "persona": ""}
вход: "теперь ты сварливый дед" → {"isPersonaChange": true, "persona": "Сварливый старый дед. Ворчит на молодёжь, всё было лучше раньше, разговорный грубоватый язык, постоянно чем-то недоволен."}`;

/**
 * Confirm via LLM whether a candidate message is really a persona-change request,
 * and extract a clean, enriched persona description. Filters false positives.
 * @returns {Promise<{isPersonaChange: boolean, persona?: string}>}
 */
export async function extractPersona(message) {
  try {
    const raw = await llm.generateReply({
      systemInstruction: EXTRACT_SYSTEM,
      messages: [{ role: 'user', content: message }],
    });
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      return { isPersonaChange: false };
    }
    const json = JSON.parse(raw.substring(first, last + 1));
    const persona = String(json.persona || '').trim();
    if (json.isPersonaChange === true && persona) {
      return { isPersonaChange: true, persona };
    }
    return { isPersonaChange: false };
  } catch (err) {
    console.warn(`Persona extraction failed: ${err.message}`);
    return { isPersonaChange: false };
  }
}
