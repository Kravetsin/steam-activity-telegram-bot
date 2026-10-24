#!/usr/bin/env bash
# Rebuild and restart the bot on the VPS. Postgres is left running — only the bot image changes.
#   ./redeploy.sh
set -euo pipefail
ROOT=/opt/steam-bot
cd "$ROOT"

[ -f .env ] || { echo "ERROR: $ROOT/.env is missing"; exit 1; }
chmod 600 .env
mkdir -p /opt/steam-bot-data/pg /opt/steam-bot-data/backups

echo '>>> Building the bot image...'
docker compose build bot

echo '>>> Starting postgres + bot...'
docker compose up -d

echo '>>> Done.'
docker compose ps
