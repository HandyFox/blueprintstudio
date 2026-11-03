#!/usr/bin/env bash
# Snapshot accounts + drawings. Add to cron, e.g.:
#   15 3 * * * /opt/blueprintstudio/deploy/backup.sh /var/backups/blueprintstudio
set -euo pipefail
cd "$(dirname "$0")/.."
dest="${1:-./backups}"
mkdir -p "$dest"
stamp=$(date +%Y%m%d-%H%M%S)
tar -czf "$dest/blueprintstudio-$stamp.tgz" data
# keep the last 30
ls -1t "$dest"/blueprintstudio-*.tgz | tail -n +31 | xargs -r rm --
echo "Backed up to $dest/blueprintstudio-$stamp.tgz"
