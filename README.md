# Steam Activity Telegram Bot

A Telegram bot that updates chat member tags based on their Steam activity: it displays the name of the game the user is currently playing.

## Requirements

- Node.js 18+
- [Steam Web API](https://steamcommunity.com/dev/apikey) key
- Bot token from [@BotFather](https://t.me/BotFather)

## Installation

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `STEAM_API_KEY` — Steam Web API key
- `TELEGRAM_BOT_TOKEN` — Bot token
- `TELEGRAM_CHAT_ID` — (optional) Chat ID if the bot only runs in one chat
- `POLL_INTERVAL_MS` — (optional) Steam poll interval in ms, default 60000 (1 min)
- `PING_MENTIONS` — (optional) Space-separated @usernames for the `/ping` command (e.g. `@user1 @user2`). Kept in `.env` only so the list is not committed to the repo.

## Running

```bash
npm start
```

Development mode with auto-restart:

```bash
npm run dev
```

## Deploying (e.g. Render.com)

- **Background Worker** (recommended): Create a "Background Worker" service. Start command: `npm start`. No port is required.
- **Web Service**: If you use a "Web Service", the app binds to `PORT` when set and responds with "Bot is running" so Render's health check passes. Set all env vars in the Render dashboard.

## Setting up the bot in a group

1. Add the bot to a supergroup.
2. Make the bot an **administrator** with the **"Manage member tags"** (can_manage_tags) permission. Without this, tags cannot be updated.

## Commands

- **`/link <Steam ID or vanity>`** — Link your Steam ID to your account in this chat. You can use a 64-bit Steam ID (17 digits) or a custom URL (e.g. username from your profile link).
- **`/unlink`** — Unlink your Steam ID in the current chat.
- **`/ping`** — Sends a message that mentions all usernames listed in `PING_MENTIONS` (from `.env`). Use it to notify a fixed list of people in the group (e.g. for game sessions). If `PING_MENTIONS` is not set, the bot replies that the list is not configured.

After linking, the bot periodically polls the Steam API and updates the member's tag: either the current game name or "Not in game".

## Limitations

- **Steam:** The user's profile must be public (or "Friends only"), otherwise the current game is not returned by the API.
- **Telegram:** Tag is up to 16 characters, no emoji. Long game names are truncated.
- **Regular members** get a member tag via `setChatMemberTag` (Bot API 9.5+, requires bot to have *can_manage_tags*). **Administrators** get a custom title via `setChatAdministratorCustomTitle`; the bot can only set custom titles for admins it has promoted (or for any admin if the bot is the chat owner).

## Project structure

```
src/
  index.js   — Entry point, bot and scheduler startup
  bot.js     — /link, /unlink, /ping commands, tag setting
  steam.js   — Steam API requests (ResolveVanityURL, GetPlayerSummaries)
  storage.js — Link storage (JSON in data/)
  scheduler.js — Periodic Steam polling and tag updates
```

Link data is stored in `data/linked-users.json`.
