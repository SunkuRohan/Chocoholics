#!/bin/sh
# Starts the built-in Postgres (unless DATABASE_URL points at your own database), then the app.
set -e
APP_DIR="${APP_DIR:-/app}"
PGDATA="${PGDATA:-/var/lib/postgresql/data}"

as() { u="$1"; shift; if command -v su-exec >/dev/null 2>&1; then su-exec "$u" "$@"; else runuser -u "$u" -- "$@"; fi; }
psql_admin() { as postgres psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }

EMBEDDED=0
if [ -z "$DATABASE_URL" ]; then
  EMBEDDED=1
  mkdir -p "$PGDATA"; chown postgres "$PGDATA"; chmod 700 "$PGDATA"
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "Setting up the built-in database (first run)..."
    as postgres initdb -D "$PGDATA" --auth=trust -U postgres >/dev/null
  fi
  # Listens on 127.0.0.1 inside the container only, so it is never reachable from outside.
  as postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1" -w -l /tmp/postgres.log start >/dev/null \
    || { cat /tmp/postgres.log; exit 1; }
  psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname='chocoholics'" | grep -q 1 \
    || psql_admin -c "CREATE ROLE chocoholics LOGIN" >/dev/null
  psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='chocoholics'" | grep -q 1 \
    || psql_admin -c "CREATE DATABASE chocoholics OWNER chocoholics" >/dev/null
  export DATABASE_URL="postgres://chocoholics@127.0.0.1:5432/chocoholics"
else
  echo "Using the external database from DATABASE_URL"
fi

cd "$APP_DIR"
as app node server.js &
NODE_PID=$!

stop() {
  kill -TERM "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  if [ "$EMBEDDED" = 1 ]; then as postgres pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true; fi
}
trap 'stop; exit 0' TERM INT

CODE=0
wait "$NODE_PID" || CODE=$?
stop
exit "$CODE"
