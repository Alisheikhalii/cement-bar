#!/usr/bin/env bash
# Restore a backup produced by backup.sh (host mode). DESTRUCTIVE: replaces the
# current database contents (and uploads if --uploads is given).
#
# Usage:
#   infra/scripts/restore.sh <cement-bar-db-XXXX.dump.gz> [--uploads <cement-bar-uploads-XXXX.tar.gz>]
#                            [--yes] [--no-pre-backup]
#
#   --yes            skip the interactive confirmation (for scripted DR drills)
#   --no-pre-backup  do not take a safety backup of the current state first
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env.prod}"

log() { printf '[restore] %s\n' "$*"; }
die() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

DB_FILE=""
UP_FILE=""
ASSUME_YES=0
PRE_BACKUP=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uploads) UP_FILE="${2:?--uploads needs a file}"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --no-pre-backup) PRE_BACKUP=0; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) [[ -z "$DB_FILE" ]] || die "only one database file allowed"; DB_FILE="$1"; shift ;;
  esac
done

[[ -n "$DB_FILE" ]] || die "usage: restore.sh <db.dump.gz> [--uploads <uploads.tar.gz>] [--yes]"
[[ -f "$DB_FILE" ]] || die "not found: $DB_FILE"
[[ -z "$UP_FILE" || -f "$UP_FILE" ]] || die "not found: $UP_FILE"
[[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE"
gzip -t "$DB_FILE" || die "database backup is corrupt: $DB_FILE"
[[ -z "$UP_FILE" ]] || gzip -t "$UP_FILE" || die "uploads archive is corrupt: $UP_FILE"

dc() { docker compose -f "$COMPOSE_DIR/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }

log "about to REPLACE the production database with: $DB_FILE"
[[ -z "$UP_FILE" ]] || log "and REPLACE all uploads with: $UP_FILE"
if [[ "$ASSUME_YES" != "1" ]]; then
  [[ -t 0 ]] || die "no TTY for confirmation; re-run with --yes if you are sure"
  read -r -p "Type RESTORE to continue: " answer
  [[ "$answer" == "RESTORE" ]] || die "aborted"
fi

if [[ "$PRE_BACKUP" == "1" ]]; then
  log "taking safety backup of current state first"
  BACKUP_RETENTION_DAYS=36500 "$SCRIPT_DIR/backup.sh"
fi

log "stopping application services"
dc stop nginx web worker api

dc up -d postgres
log "restoring database"
# shellcheck disable=SC2016 # expanded inside the container on purpose
gunzip -c "$DB_FILE" | dc exec -T postgres sh -c \
  'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error'

if [[ -n "$UP_FILE" ]]; then
  log "restoring uploads"
  dc run --rm --no-deps -T --entrypoint sh api -c \
    'find /app/uploads -mindepth 1 -delete && tar -xzf - -C /app/uploads' < "$UP_FILE"
fi

log "starting application services (api applies pending migrations on start)"
dc up -d
log "restore finished; verify with: infra/scripts/deploy.sh --no-smoke  (or check logs)"
