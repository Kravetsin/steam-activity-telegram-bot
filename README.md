# AI Chat Telegram Bot

A Telegram bot that joins a group chat as a character. It listens passively, responds when addressed, remembers the participants over time, and can draw pictures. Powered by **Claude (Anthropic)**.

## How it works

- Listens to every text message in groups where it's added (Privacy Mode must be off in @BotFather).
- **Responds only when** the message either `@mentions` the bot or is a Telegram-reply to one of the bot's previous messages. Other messages are still saved to history for context but don't trigger a reply.
- **Filtered out** before saving: emoji-only messages, single-character messages, slash commands, and messages from other bots.
- Holds a rolling context window of the last ~25 messages per chat and sends them to Claude together with a persona system prompt.
- Once a day at `DAILY_RESET_HOUR` runs a single structured-output call per chat that extracts stable facts about each user, saves them, and clears the day's messages. Facts are injected into future prompts so the bot "remembers" people across the rolling window.
- All bot replies are sent silently (`disable_notification: true`) so the chat doesn't get pinged.
- If the API is rate-limited or unavailable, the bot sends a single in-character snarky phrase and enters a 60-second per-chat cooldown.
- Safety refusals (`stop_reason: "refusal"`) are logged and skipped silently — no out-of-character error is posted to the chat.

## Requirements

- Node.js 20+ (24 LTS recommended)
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys)
- PostgreSQL connection string, e.g. `postgres://user:pass@host:5432/db`. The schema is created on first boot.

## Installation

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `TELEGRAM_BOT_TOKEN` — required.
- `ANTHROPIC_API_KEY` — required.
- `ANTHROPIC_MODEL` — main chat model, defaults to `claude-sonnet-5-5`. `claude-haiku-5-5` is ~20x cheaper if you want to test cheaply.
- `ANTHROPIC_UTILITY_MODEL` — background calls (fact extraction, persona detection, image prompts), defaults to `claude-haiku-5-5`.
- `ANTHROPIC_MAX_TOKENS` — defaults to `1024`. If you set `ANTHROPIC_THINKING=adaptive`, raise it: thinking tokens count toward this limit.
- `ANTHROPIC_EFFORT` — `low` (default) keeps replies fast. Allowed: `low`, `medium`, `high`, `xhigh`, `max`.
- `ANTHROPIC_THINKING` — `auto` by default. It picks `between_tools` for Sonnet 5.5 (which rejects `disabled` with a 400) and `disabled` for Haiku 5.5.
- `DATABASE_URL` — required.
- `BOT_NAME`, `DAILY_RESET_HOUR`, `CONTEXT_WINDOW`, `DNS_SERVERS` — optional.
- `WEBHOOK_DOMAIN`, `HOST`, `PORT` — deployment options, see below.

Check the key and model before starting the bot:

```bash
npm run smoke
```

It makes one chat request and one structured-JSON request and prints timing. A 401 means a bad key, a 404 means a wrong model ID, a 403 usually means the API is not available from your region.

## Setting up the bot in a group

1. **Disable Privacy Mode** in @BotFather: `/mybots` → choose bot → **Bot Settings → Group Privacy → Turn off**. Without this, the bot only sees `@mentions` and explicit replies, so it can't build chat history.
2. Add the bot to a group.
3. If the bot was already in the group when you toggled privacy mode, remove it and add it back so the change takes effect.

## Running

```bash
npm start          # production
npm run dev        # nodemon, restarts on file changes
```

## Deploying to a VPS

Runs in Docker: one container for the bot, one for PostgreSQL. Setup on a fresh Ubuntu 22.04/24.04 VPS:

```bash
# as root
git clone <repo> /opt/steam-bot
cd /opt/steam-bot

cp .env.example .env
chmod 600 .env

# URL-safe password, no escaping headaches in the connection string
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
nano .env      # TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY

chmod +x redeploy.sh backup-db.sh
./redeploy.sh
docker compose logs -f bot
```

`compose.yml` keeps Postgres unpublished (reachable only over the compose network), stores data in
`/opt/steam-bot-data/pg`, and derives `DATABASE_URL` from `POSTGRES_*` — credentials live in one place.
The schema is created on first boot; there are no migrations to run.

Nightly backups (14 days retained):

```bash
echo '15 4 * * * /opt/steam-bot/backup-db.sh >> /var/log/steam-bot-backup.log 2>&1' | crontab -
```

Everyday commands:

```bash
docker compose logs -f bot          # logs
docker compose restart bot          # after editing .env
docker compose exec bot npm run extract:now   # run fact extraction immediately
./redeploy.sh                       # rebuild after a code change
```

Restore from a backup:

```bash
gunzip -c /opt/steam-bot-data/backups/steam_bot-<stamp>.sql.gz \
  | docker compose exec -T postgres psql -U steam_bot -d steam_bot
```

- **Polling** (no domain needed): leave `WEBHOOK_DOMAIN` empty. Do not set `PORT` unless you want the health endpoint.
- **Webhook** (recommended with a domain): set `WEBHOOK_DOMAIN=https://bot.example.com`, `PORT=3000`, keep `HOST=127.0.0.1`, and put Caddy in front:

```caddyfile
bot.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

- `TZ` in `compose.yml` defaults to `Europe/Kyiv` — the daily extractor uses local time. Without it, facts get collected at an unexpected hour.
- Postgres data and backups live in `/opt/steam-bot-data` — outside the build context, so redeploys never touch them.
- Only one instance may poll a bot token. Stop the old deployment before starting the new one.

## Models, costs, and tuning

Claude Sonnet 5.5 pricing is $2 / $10 per million input / output tokens. A typical reply in this bot (system prompt + 25-message window ≈ 2.5K input, ~150 output) costs about **$0.0065**, so ~$6.5 per 1000 replies. Haiku 5.5 is ~20x cheaper.

Sonnet 5.5 notes:

- It rejects `temperature`, `top_p`, and `top_k` with a 400 — `src/llm.js` doesn't send them.
- Thinking is on by default. `thinking: {type: "between_tools"}` turns off up-front thinking (accepted at `low`/`medium`/`high` effort).
- `output_config.effort` controls how much work the model does. For chat, `low` is the right default.

Switching models is an env change: set `ANTHROPIC_MODEL` and restart. `ANTHROPIC_THINKING=auto` adapts to the model. If you switch to Sonnet 5.5 from an older model, re-run `npm run smoke` — the API returns clear 400s for unsupported parameters.

## Project structure

```
src/
  index.js               — entry point: env validation, Postgres connect, bot launch, scheduler
  config.js              — env parsing, thinking/effort resolution, validation
  bot.js                 — Telegram message handler: filter → addressed-check → load context → LLM → reply
  llm.js                 — Claude client, error mapping (429/529/5xx/refusals), markdown stripping
  schemas.js             — JSON Schemas for structured outputs (facts, persona, image prompt)
  prompts.js             — persona prompt template, fact-extraction prompt, fallback phrases
  db.js                  — Postgres pool, bigint parsing, schema bootstrap
  storage.js             — SQL queries for messages, facts, and personas
  scheduler.js           — daily fact extraction + context cleanup
scripts/
  smoke.js               — one chat + one JSON request, for verifying the API key/model
  extract-now.js         — run daily fact extraction immediately instead of waiting
```

## Notes

- Persona text and rate-limit fallback phrases live in `src/prompts.js` — edit there to change character.
- Persona has guardrails: no personal attacks by identity, no real-world politics/religion, no real-world NSFW/violence. Profanity is allowed when natural (target audience: adult chat).
- No web search / grounding — Claude uses its own knowledge cutoff.
- Utility calls use structured outputs (`output_config.format`), so fact extraction and persona detection no longer depend on parsing JSON out of free-form text.
