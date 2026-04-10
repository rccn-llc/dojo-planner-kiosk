#!/usr/bin/env bash
# Wrapper around pglite-server that recovers from unclean shutdowns.
#
# PGLite's WASM runtime cannot replay WAL during crash recovery. If the
# previous session was killed uncleanly, pglite-server will abort on start.
# Recovery: use pg_resetwal to reset pg_control to "shut down" state and
# clear WAL files. All committed/checkpointed data is preserved; only
# in-flight transactions from the crashed session are lost.

DB_PATH="${1:?Usage: db-server.sh <db-path>}"

# PGLite uses PostgreSQL 17 internally — we need the matching pg_resetwal
PG_RESETWAL=$(find /opt/homebrew/Cellar/libpq /opt/homebrew/Cellar/postgresql@17 /usr/local/Cellar/libpq /usr/local/Cellar/postgresql@17 -name "pg_resetwal" 2>/dev/null | head -1)
# Fall back to whatever is on PATH if nothing found above
PG_RESETWAL="${PG_RESETWAL:-$(which pg_resetwal 2>/dev/null)}"

# Clear stale lock file from any previous unclean shutdown
rm -f "$DB_PATH/postmaster.pid"

npx pglite-server --db="$DB_PATH"
EXIT_CODE=$?

# Exit code 1 = pglite-server aborted on startup (WAL replay failure).
# Any other exit code (0, 130, 143, ...) means normal operation + user stop.
if [ "$EXIT_CODE" -eq 1 ]; then
  if [ -z "$PG_RESETWAL" ]; then
    echo "pg_resetwal not found — cannot auto-recover. Install PostgreSQL (brew install postgresql) and retry."
    exit 1
  fi
  echo ""
  echo "PGLite crash recovery: resetting WAL state with pg_resetwal..."
  rm -f "$DB_PATH/postmaster.pid"
  "$PG_RESETWAL" -f "$DB_PATH" 2>&1
  echo "Recovery complete. Retrying..."
  echo ""
  npx pglite-server --db="$DB_PATH"
fi
