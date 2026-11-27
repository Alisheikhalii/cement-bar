#!/usr/bin/env bash
# Print a fresh production env file with strong random secrets to stdout.
#
#   infra/scripts/gen-secrets.sh --domain bar.example.ir --tag v0.1.0 > infra/docker/.env.prod
#   chmod 600 infra/docker/.env.prod
#
# NEVER commit the output (the repository is public). Keep an offline copy:
# losing FIELD_ENCRYPTION_KEY makes encrypted national ids / IBANs unrecoverable.
set -euo pipefail

DOMAIN="example.invalid"
TAG="latest"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

b64() { openssl rand -base64 "$1" | tr -d '\n'; }
hex() { openssl rand -hex "$1"; }

PG_USER=cb
PG_DB=cement_bar
PG_PASS="$(hex 24)"
REDIS_PASS="$(hex 24)"

cat <<EOF
# cement-bar production env — generated $(date -u +%FT%TZ). DO NOT COMMIT.
# --- compose interpolation ---
TAG=${TAG}
DOMAIN=${DOMAIN}
POSTGRES_USER=${PG_USER}
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=${PG_DB}
REDIS_PASSWORD=${REDIS_PASS}
# IMAGE_PREFIX=ghcr.io/alisheikhalii
# BACKUP_HOST_DIR=/var/backups/cement-bar

# --- application ---
NODE_ENV=production
TZ=UTC
DATABASE_URL=postgresql://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}?schema=public
REDIS_URL=redis://:${REDIS_PASS}@redis:6379
API_PORT=4000
WEB_PORT=3000
WEB_ORIGIN=https://${DOMAIN}
JWT_ACCESS_SECRET=$(b64 48)
JWT_REFRESH_SECRET=$(b64 48)
FIELD_ENCRYPTION_KEY=$(b64 32)
FIELD_HASH_KEY=$(b64 32)
COOKIE_SECURE=true
UPLOAD_DIR=/app/uploads
BUSINESS_TIMEZONE=Asia/Tehran
LOG_LEVEL=info
EOF
