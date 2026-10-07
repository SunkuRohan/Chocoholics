#!/usr/bin/env bash
# Dump the database to ./backups/chocoholics-<timestamp>.sql.gz
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
f="backups/chocoholics-$(date +%F-%H%M%S).sql.gz"
sudo docker compose exec -T db pg_dump -U chocoholics chocoholics | gzip > "$f"
echo "Saved $f"
