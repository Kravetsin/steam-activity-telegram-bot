#!/usr/bin/env bash
# Pull the latest code and redeploy. The checkout on the VPS is never edited by hand:
# local changes would block the fast-forward.
set -euo pipefail
cd /opt/steam-bot

git pull --ff-only
./redeploy.sh
