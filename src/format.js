// Telegram accepts only a small subset of HTML. The model is told which tags to use,
// but it drifts: markdown creeps in, a stray `<` from a comparison operator ends up in
// the text, or a tag is left unclosed. Any of those makes Telegram reject the whole
// message with 400, so everything is normalised here before sending.
//
// toTelegramHtml() keeps whitelisted tags, drops unknown ones, escapes everything else,
// and degrades to fully-escaped plain text if the markup ends up unbalanced.

const ALLOWED_TAG = /^<\/?(b|strong|i|em|u|s|code|pre)>$/i;
const OPENING_LINK = /^<a href="https?:\/\/[^"<>]+">$/i;
const CLOSING_LINK = /^<\/a>$/i;
const ANY_TAG = /<\/?[a-zA-Z][^>]*>/g;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;
// Entities the model may already have written; escaping them again would show the
// entity source instead of the character.
const BARE_AMP = /&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi;

function isAllowed(tag) {
  return ALLOWED_TAG.test(tag) || OPENING_LINK.test(tag) || CLOSING_LINK.test(tag);
}

function tagName(tag) {
  const m = /^<\/?([a-zA-Z]+)/.exec(tag);
  return m ? m[1].toLowerCase() : '';
}

// Telegram rejects a message whose tags don't nest properly, so check before sending.
function isBalanced(html) {
  const stack = [];
  for (const tag of html.match(ANY_TAG) || []) {
    const name = tagName(tag);
    if (tag.startsWith('</')) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}

function escapeText(text) {
  return String(text ?? '')
    .replace(BARE_AMP, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function toTelegramHtml(text) {
  let out = String(text ?? '').replace(BARE_AMP, '&amp;');

  // Pull allowed tags out of the way before the escaping pass, otherwise their own
  // angle brackets would be escaped and Telegram would show them as literal text.
  const kept = [];
  let droppedLinks = 0;
  out = out.replace(ANY_TAG, (tag) => {
    // A rejected <a> would leave an orphan </a> that Telegram refuses; drop the pair.
    if (CLOSING_LINK.test(tag) && droppedLinks > 0) {
      droppedLinks -= 1;
      return '';
    }
    if (isAllowed(tag)) {
      kept.push(tag);
      return `\u0000${kept.length - 1}\u0000`;
    }
    if (/^<a\b/i.test(tag)) droppedLinks += 1;
    return '';
  });

  // Whatever angle brackets survived are literal text (e.g. "if (a < b)").
  out = out.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  out = out.replace(PLACEHOLDER, (_, i) => kept[Number(i)]);

  // Unclosed or crossed tags would fail with 400; send the text instead of losing it.
  if (!isBalanced(out)) {
    console.warn('Unbalanced Telegram HTML, falling back to plain text:', out.slice(0, 120));
    return escapeText(String(text ?? '').replace(ANY_TAG, ''));
  }

  return out;
}

// Last resort for when Telegram still refuses the markup: send it unformatted.
export function toPlainText(text) {
  return String(text ?? '')
    .replace(ANY_TAG, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
