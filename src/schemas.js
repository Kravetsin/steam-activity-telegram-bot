// JSON Schemas for Claude structured outputs (output_config.format).
// Every object needs additionalProperties: false; every property must be listed
// in "required" — that's what makes the response guaranteed-parseable.

export const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    users: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          telegramUserId: { type: 'integer' },
          newFacts: { type: 'array', items: { type: 'string' } },
        },
        required: ['telegramUserId', 'newFacts'],
        additionalProperties: false,
      },
    },
  },
  required: ['users'],
  additionalProperties: false,
};

export const PERSONA_SCHEMA = {
  type: 'object',
  properties: {
    isPersonaChange: { type: 'boolean' },
    persona: { type: 'string' },
  },
  required: ['isPersonaChange', 'persona'],
  additionalProperties: false,
};

export const IMAGE_PROMPT_SCHEMA = {
  type: 'object',
  properties: {
    prompt: { type: 'string' },
    negative_prompt: { type: 'string' },
  },
  required: ['prompt', 'negative_prompt'],
  additionalProperties: false,
};
