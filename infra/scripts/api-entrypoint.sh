#!/usr/bin/env bash
# Entrypoint for the cement-bar API / worker image.
#   RUN_MIGRATIONS=1  -> run `prisma migrate deploy` before starting (api service only;
#                        never set it on the worker to avoid concurrent migrations).
#   WORKER=1          -> interpreted by the application itself (same command).
set -euo pipefail

cd /app

if [[ "${RUN_MIGRATIONS:-0}" == "1" ]]; then
  if [[ -x /app/node_modules/.bin/prisma ]]; then
    PRISMA_BIN=/app/node_modules/.bin/prisma
  elif [[ -x /opt/prisma-cli/node_modules/.bin/prisma ]]; then
    PRISMA_BIN=/opt/prisma-cli/node_modules/.bin/prisma
  else
    echo "[entrypoint] FATAL: prisma CLI not found; cannot run migrations" >&2
    exit 1
  fi
  echo "[entrypoint] running prisma migrate deploy"
  "$PRISMA_BIN" migrate deploy --schema=/app/prisma/schema.prisma
  echo "[entrypoint] migrations applied"
fi

exec "$@"
