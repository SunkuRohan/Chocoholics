#!/usr/bin/env bash
# Replace the database contents with a backup: ./restore.sh backups/<file>.sql.gz
set -euo pipefail
cd "$(dirname "$0")"
[ $# -eq 1 ] && [ -f "$1" ] || { echo "Usage: $0 backups/<file>.sql.gz"; exit 1; }
read -r -p "This ERASES the current data and loads $1. Type yes to continue: " a
[ "$a" = "yes" ] || { echo "Cancelled."; exit 1; }
sudo docker compose stop app
sudo docker compose exec -T db psql -U chocoholics chocoholics -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c "$1" | sudo docker compose exec -T db psql -U chocoholics chocoholics
sudo docker compose start app
echo "Restored from $1"
