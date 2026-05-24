# AI Chat Telegram Bot

A Telegram bot that joins a group chat as a character (currently: the Lich King from Warcraft). Listens to chat passively, responds when addressed, learns about the participants over time. **Provider-agnostic** — works with any OpenAI-compatible LLM API (default: Groq). Swap providers by changing `LLM_BASE_URL` + key.

## How it works

- Listens to every text message in groups where it's added (Privacy Mode must be off in @BotFather).
- **Responds only when** the message either `@mentions` the bot or is a Telegram-reply to one of the bot's previous messages. Other messages are still saved to history for context but don't trigger a reply.
- **Filtered out** before saving: emoji-only messages, single-character messages, slash commands, and messages from other bots.
- Holds a rolling context window of the last ~25 messages per chat and sends them to the LLM together with a persona system prompt.
- Once a day at `DAILY_RESET_HOUR` runs a single LLM call per chat that extracts stable facts about each user, saves them, and clears the day's messages. Facts are injected into future prompts so the bot "remembers" people across the rolling window.
- All bot replies are sent silently (`disable_notification: true`) so the chat doesn't get pinged.
- If the LLM is rate-limited or unavailable, the bot sends a single in-character snarky phrase and enters a 60-second per-chat cooldown.

## Requirements

- Node.js 18+
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- LLM API key — by default Groq from [console.groq.com/keys](https://console.groq.com/keys) (free tier, no card required). Any OpenAI-compatible provider works by adjusting `LLM_BASE_URL`.
- MongoDB connection string (Atlas free tier, or any Mongo deployment)

## Installation

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `TELEGRAM_BOT_TOKEN` — required, from BotFather.
- `LLM_API_KEY` — required, key for the LLM provider (default Groq).
- `LLM_BASE_URL` — optional, OpenAI-compatible API base URL. Defaults to `https://api.groq.com/openai/v1`. Swap to e.g. `https://openrouter.ai/api/v1` or `https://api.openai.com/v1`.
- `LLM_MODEL` — optional, provider-specific model ID. Defaults to `llama-3.3-70b-versatile` (Groq). Free Groq alternatives: `llama-3.1-8b-instant` (much higher daily ceiling), `deepseek-r1-distill-llama-70b` (reasoning-tuned).
- `MONGODB_URI` — required, e.g. `mongodb+srv://...`.
- `BOT_NAME` — optional, name used in the persona prompt and logs.
- `DAILY_RESET_HOUR` — optional, defaults to `4`.
- `CONTEXT_WINDOW` — optional, defaults to `25`.
- `DNS_SERVERS` — optional, comma-separated public DNS servers. Useful only if the local system DNS resolver doesn't handle SRV records (VPN/antivirus). Leave empty in production.

## Setting up the bot in a group

1. **Disable Privacy Mode** in @BotFather: `/mybots` → choose bot → **Bot Settings → Group Privacy → Turn off**. Without this, the bot only sees `@mentions` and explicit replies, so it can't build chat history.
2. Add the bot to a group.
3. If the bot was already in the group when you toggled privacy mode, remove it and add it back so the change takes effect.

## Running

```bash
npm start          # production
npm run dev        # nodemon, restarts on file changes
```

## Deploying (Render.com)

- Use a **Background Worker** (recommended) with start command `npm start`.
- Or use a **Web Service**: the bot binds to `PORT` when set and responds with `Bot is running` on `/` so the health check passes.
- Set all env vars in the Render dashboard. **Don't** set `DNS_SERVERS` on Render — system DNS works there.

## Swapping LLM provider or model

Within Groq — change `LLM_MODEL` in `.env` and restart.
To switch provider entirely — set `LLM_BASE_URL` (and new `LLM_API_KEY`) in `.env`. No code change needed since `src/llm.js` uses plain `fetch` against any OpenAI-compatible Chat Completions endpoint. Tune `temperature` and `max_tokens` in `src/llm.js` if you want different defaults.

## Project structure

```
src/
  index.js               — entry point: env validation, Mongo connect, bot launch, scheduler
  config.js              — central env-var parsing and validation
  bot.js                 — Telegram message handler: filter → addressed-check → load context → LLM → reply
  llm.js                 — provider-agnostic LLM wrapper (fetch-based, OpenAI-compatible), rate-limit detection, markdown stripping
  prompts.js             — persona prompt template, fact-extraction prompt, fallback phrases
  storage.js             — Mongoose CRUD for messages and facts
  scheduler.js           — daily fact extraction + context cleanup
  models/
    ChatMessage.js       — rolling chat history
    UserFact.js          — per-user extracted facts (capped at 50 per user per chat)
```

## Notes

- The persona currently embodies the Lich King (Arthas Menethil / Ner'zhul). Persona text and rate-limit fallback phrases live in `src/prompts.js` — edit there to change character.
- Persona has guardrails: no personal attacks by identity, no real-world politics/religion, no real-world NSFW/violence. Profanity is allowed when natural (target audience: adult chat).
- No web search / grounding — the LLM uses its own knowledge cutoff. For very recent events the bot will admit it doesn't know.
