#!/usr/bin/env bash
# Nightly logical backup of the bot database. Keeps 14 days, gzipped.
# Add to root's crontab:
#   15 4 * * * /opt/steam-bot/backup-db.sh >> /var/log/steam-bot-backup.log 2>&1
set -euo pipefail
cd /opt/steam-bot

# Read only the two vars we need: sourcing .env directly would choke on unquoted
# values with spaces (BOT_NAME, for instance).
PG_USER=$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'\r ')
PG_DB=$(grep -E '^POSTGRES_DB=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'\r ')
PG_USER=${PG_USER:-steam_bot}
PG_DB=${PG_DB:-steam_bot}

DEST=/opt/steam-bot-data/backups
mkdir -p "$DEST"
STAMP=$(date +%Y%m%dT%H%M%S)

docker compose exec -T postgres \
  pg_dump -U "$PG_USER" -d "$PG_DB" \
  | gzip > "$DEST/steam_bot-$STAMP.sql.gz"

find "$DEST" -name 'steam_bot-*.sql.gz' -mtime +14 -delete
echo "$(date -Is) backup written: steam_bot-$STAMP.sql.gz ($(du -h "$DEST/steam_bot-$STAMP.sql.gz" | cut -f1))"
