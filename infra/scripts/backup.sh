#!/usr/bin/env bash
# Backup PostgreSQL (pg_dump -Fc, gzipped) and optionally the uploads volume.
#
# Two modes (auto-detected):
#   container mode : PGHOST is set and pg_dump exists (the compose `backup` profile).
#                    Uses PG* env vars; uploads read from $UPLOADS_SRC (default /uploads).
#   host mode      : run on the server (e.g. from cron); uses `docker compose exec` into
#                    the postgres container and the api image to tar the uploads volume.
#
# Env:
#   BACKUP_DIR              target dir (host default: /var/backups/cement-bar)
#   BACKUP_RETENTION_DAYS   delete backups older than N days (default 14)
#   BACKUP_UPLOADS          1 = also archive uploads (default 1)
#   ENV_FILE                host mode: path to .env.prod (default infra/docker/.env.prod)
#
# Example cron (host mode, 02:30 UTC daily):
#   30 2 * * * /opt/cement-bar/infra/scripts/backup.sh >> /var/log/cement-bar-backup.log 2>&1
set -euo pipefail
umask 077

RETENTION="${BACKUP_RETENTION_DAYS:-14}"
WITH_UPLOADS="${BACKUP_UPLOADS:-1}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

log() { printf '[backup %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

if [[ -n "${PGHOST:-}" ]] && command -v pg_dump >/dev/null 2>&1; then
  MODE=container
  BACKUP_DIR="${BACKUP_DIR:-/backups}"
else
  MODE=host
  BACKUP_DIR="${BACKUP_DIR:-/var/backups/cement-bar}"
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  COMPOSE_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"
  ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env.prod}"
  [[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE"
  dc() { docker compose -f "$COMPOSE_DIR/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }
fi

mkdir -p "$BACKUP_DIR"
DB_OUT="$BACKUP_DIR/cement-bar-db-$STAMP.dump.gz"
UP_OUT="$BACKUP_DIR/cement-bar-uploads-$STAMP.tar.gz"

cleanup() { rm -f "$DB_OUT.partial" "$UP_OUT.partial"; }
trap cleanup EXIT

log "mode=$MODE dir=$BACKUP_DIR"

# --- database ---------------------------------------------------------------------
if [[ "$MODE" == "container" ]]; then
  pg_dump -Fc --no-owner --no-privileges | gzip -6 > "$DB_OUT.partial"
else
  # Credentials are taken from the postgres container's own env (no secrets on argv).
  # shellcheck disable=SC2016 # expanded inside the container on purpose
  dc exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges' \
    | gzip -6 > "$DB_OUT.partial"
fi
gzip -t "$DB_OUT.partial" || die "database backup is corrupt"
[[ -s "$DB_OUT.partial" ]] || die "database backup is empty"
mv "$DB_OUT.partial" "$DB_OUT"
log "database -> $DB_OUT ($(du -h "$DB_OUT" | cut -f1))"

# --- uploads ----------------------------------------------------------------------
if [[ "$WITH_UPLOADS" == "1" ]]; then
  if [[ "$MODE" == "container" ]]; then
    src="${UPLOADS_SRC:-/uploads}"
    if [[ -d "$src" ]]; then
      tar -C "$src" -czf "$UP_OUT.partial" .
    else
      log "uploads dir $src not mounted; skipping"
    fi
  else
    dc run --rm --no-deps -T --entrypoint tar api -C /app/uploads -czf - . > "$UP_OUT.partial"
  fi
  if [[ -f "$UP_OUT.partial" ]]; then
    gzip -t "$UP_OUT.partial" || die "uploads archive is corrupt"
    mv "$UP_OUT.partial" "$UP_OUT"
    log "uploads -> $UP_OUT ($(du -h "$UP_OUT" | cut -f1))"
  fi
fi

# --- retention --------------------------------------------------------------------
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cement-bar-*' -mtime "+$RETENTION" -print -delete \
  | sed 's/^/[backup] pruned /' || true

log "done"
