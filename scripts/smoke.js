import { config, validateConfig, thinkingForModel } from '../src/config.js';
import { generateReply, generateJSON } from '../src/llm.js';
import { IMAGE_PROMPT_SCHEMA } from '../src/schemas.js';

try {
  validateConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

console.log('Chat model:');
console.log('  id       :', config.anthropicModel);
console.log('  thinking :', JSON.stringify(thinkingForModel(config.anthropicModel)));
console.log('  effort   :', config.anthropicEffort);
console.log('  max_tokens:', config.anthropicMaxTokens);
console.log('Utility model:');
console.log('  id       :', config.anthropicUtilityModel);
console.log('  thinking :', JSON.stringify(thinkingForModel(config.anthropicUtilityModel)));
console.log('  effort   :', config.anthropicUtilityEffort);
console.log('');

let failed = false;

try {
  const started = Date.now();
  const reply = await generateReply({
    systemInstruction: 'Ты коротко подтверждаешь, что связь есть. Ровно одно предложение.',
    messages: [{ role: 'user', content: 'Проверка связи.' }],
  });
  console.log(`OK   chat  (${Date.now() - started} ms): ${reply}`);
} catch (err) {
  failed = true;
  console.error(`FAIL chat  [${err.name}]: ${err.message}`);
}

try {
  const started = Date.now();
  const json = await generateJSON({
    systemInstruction:
      'Переведи запрос картинки на английский и верни prompt и negative_prompt.',
    prompt: 'кот в скафандре на Марсе',
    schema: IMAGE_PROMPT_SCHEMA,
  });
  console.log(`OK   json  (${Date.now() - started} ms):`, JSON.stringify(json));
} catch (err) {
  failed = true;
  console.error(`FAIL json  [${err.name}]: ${err.message}`);
}

if (failed) process.exitCode = 1;
