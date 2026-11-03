#!/usr/bin/env bash
# Pull the latest code from GitHub and restart. Run from the repo folder.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
if command -v docker >/dev/null && [ -f docker-compose.yml ] && docker compose ps >/dev/null 2>&1; then
    docker compose up -d --build
    docker image prune -f >/dev/null
else
    .venv/bin/pip install -q -r requirements.txt
    sudo systemctl restart blueprintstudio
fi
echo "Blueprint Studio updated."
