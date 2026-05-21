# AI Chat Telegram Bot

A Telegram bot that joins a group chat as an AI participant. Reads every message, responds in a sarcastic persona, learns stable facts about chat members over time. Powered by Google Gemini (free tier).

## How it works

- Listens to every text message in groups where it's added.
- **Ignores** emoji-only messages, single-character messages, and slash commands.
- Holds a rolling context window of the last ~25 messages per chat and feeds them to Gemini together with a persona system prompt.
- Once a day at `DAILY_RESET_HOUR` runs a single Gemini call per chat that extracts stable facts about each user, saves them, and clears the day's messages. These facts are injected into future prompts so the bot "remembers" people across the rolling window.
- If Gemini's free-tier rate limit is hit, replies with a randomized snarky fallback phrase instead.

## Requirements

- Node.js 18+
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Gemini API key from [AI Studio](https://aistudio.google.com/apikey) (free tier is enough)
- MongoDB connection string (Atlas free tier, or any Mongo deployment)

## Installation

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `TELEGRAM_BOT_TOKEN` — required, from BotFather.
- `GEMINI_API_KEY` — required, from AI Studio.
- `MONGODB_URI` — required, e.g. `mongodb+srv://...`.
- `BOT_NAME` — optional, name used in the persona prompt.
- `GEMINI_MODEL` — optional, defaults to `gemini-2.5-flash-lite`.
- `DAILY_RESET_HOUR` — optional, defaults to `4`.
- `CONTEXT_WINDOW` — optional, defaults to `25`.

## Setting up the bot in a group

1. **Disable Privacy Mode** in @BotFather: `/mybots` → choose bot → **Bot Settings → Group Privacy → Turn off**. Without this, the bot will only see messages that explicitly mention it.
2. Add the bot to a group.
3. (If the bot was already in the group when you toggled privacy mode, remove it and add it back so the change takes effect.)

## Running

```bash
npm start          # production
npm run dev        # nodemon, restarts on file changes
```

## Deploying (Render.com)

- Use a **Background Worker** (recommended) with start command `npm start`.
- Or use a **Web Service**: the bot binds to `PORT` when set and responds with `Bot is running` on `/` so the health check passes.
- Set all env vars in the Render dashboard.

## Project structure

```
src/
  index.js               — entry point: env validation, Mongo connect, bot launch, scheduler
  config.js              — central env-var parsing and validation
  bot.js                 — Telegram message handler: filter → load context → Gemini → reply
  llm.js                 — Gemini wrapper, rate-limit detection
  prompts.js             — persona prompt template, fact-extraction prompt, fallback phrases
  storage.js             — Mongoose CRUD for messages and facts
  scheduler.js           — daily fact extraction + context cleanup
  models/
    ChatMessage.js       — rolling chat history
    UserFact.js          — per-user extracted facts (capped at 50 per user per chat)
```

## Notes

- Free-tier data is used by Google for model training — avoid feeding sensitive content.
- The persona is intentionally sarcastic but has guardrails (no personal attacks, no politics, no NSFW) built into the system prompt. Tune `src/prompts.js` to taste.
