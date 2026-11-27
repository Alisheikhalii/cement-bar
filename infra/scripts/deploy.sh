#!/usr/bin/env bash
# Deploy / update / roll back the cement-bar production stack.
#
# Usage:
#   infra/scripts/deploy.sh [--tag v0.1.0] [--load images.tar.gz]... [--pull]
#                           [--init-cert you@example.com] [--no-smoke]
#
#   --tag TAG         image tag to run (overrides TAG in .env.prod). Rollback = older tag.
#   --load FILE       `docker load` a tarball produced by release.yml (repeatable);
#                     use this on servers that cannot reach GHCR / Docker Hub.
#   --pull            pull images from the registry instead (needs internet).
#   --init-cert EMAIL obtain the first Let's Encrypt certificate (webroot) and enable HTTPS.
#   --no-smoke        skip smoke tests.
#
# Env file: infra/docker/.env.prod (override with ENV_FILE=/path). Never commit it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"
COMPOSE_FILE="$COMPOSE_DIR/compose.prod.yml"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env.prod}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-300}"

TAG_OVERRIDE=""
LOAD_FILES=()
DO_PULL=0
CERT_EMAIL=""
SMOKE=1

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG_OVERRIDE="${2:?--tag needs a value}"; shift 2 ;;
    --load) LOAD_FILES+=("${2:?--load needs a file}"); shift 2 ;;
    --pull) DO_PULL=1; shift ;;
    --init-cert) CERT_EMAIL="${2:?--init-cert needs an email}"; shift 2 ;;
    --no-smoke) SMOKE=0; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

command -v docker >/dev/null || die "docker not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 plugin required"
[[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE (create it with infra/scripts/gen-secrets.sh)"

# Read a KEY=value from the env file without sourcing it (values may contain shell metachars).
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' ; }

perm="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '')"
if [[ -n "$perm" && "$perm" != "600" && "$perm" != "400" ]]; then
  log "WARNING: $ENV_FILE has mode $perm; recommended: chmod 600"
fi

if [[ -n "$TAG_OVERRIDE" ]]; then export TAG="$TAG_OVERRIDE"; fi
TAG="${TAG:-$(env_get TAG)}"
[[ -n "$TAG" ]] || die "TAG not set (pass --tag or set TAG in $ENV_FILE)"
export TAG
DOMAIN="$(env_get DOMAIN)"
[[ -n "$DOMAIN" ]] || die "DOMAIN not set in $ENV_FILE"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

log "validating compose configuration (TAG=$TAG)"
dc config --quiet

for f in "${LOAD_FILES[@]+"${LOAD_FILES[@]}"}"; do
  [[ -f "$f" ]] || die "tarball not found: $f"
  log "loading images from $f"
  if [[ "$f" == *.gz ]]; then gunzip -c "$f" | docker load; else docker load -i "$f"; fi
done

if [[ "$DO_PULL" == "1" ]]; then
  log "pulling images"
  dc pull
fi

# Every image referenced by the stack must now exist locally.
missing=0
while read -r img; do
  [[ -z "$img" ]] && continue
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    log "missing image: $img"; missing=1
  fi
done < <(dc config --images)
[[ "$missing" == "0" ]] || die "images missing; use --load <tarball> or --pull"

log "starting stack"
dc up -d --remove-orphans

container_of() { dc ps -q "$1" 2>/dev/null | head -n1; }

wait_healthy() {
  local svc="$1" deadline=$((SECONDS + WAIT_TIMEOUT)) cid status
  while (( SECONDS < deadline )); do
    cid="$(container_of "$svc")"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")"
      case "$status" in
        healthy|running) log "$svc: $status"; return 0 ;;
        unhealthy|exited|dead) dc logs --tail=80 "$svc" >&2 || true; die "$svc is $status" ;;
      esac
    fi
    sleep 3
  done
  dc logs --tail=80 "$svc" >&2 || true
  die "timeout waiting for $svc to become healthy"
}

for svc in postgres redis api worker web nginx; do wait_healthy "$svc"; done

if [[ -n "$CERT_EMAIL" ]]; then
  log "requesting Let's Encrypt certificate for $DOMAIN"
  dc run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN" --email "$CERT_EMAIL" --agree-tos --no-eff-email --non-interactive
  log "restarting nginx to enable HTTPS"
  dc restart nginx
  wait_healthy nginx
fi

if [[ "$SMOKE" == "1" ]]; then
  command -v curl >/dev/null || die "curl required for smoke tests (or use --no-smoke)"
  log "smoke tests"
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/)"
  [[ "$code" == "301" ]] || die "HTTP should redirect to HTTPS, got $code"
  if dc exec -T nginx test -f "/etc/nginx/conf.d/https.conf"; then
    base="https://$DOMAIN"
    res=(--resolve "$DOMAIN:443:127.0.0.1")
    curl -fsS "${res[@]}" "$base/api/healthz" >/dev/null || die "GET /api/healthz failed"
    curl -fsS "${res[@]}" "$base/api/readyz"  >/dev/null || die "GET /api/readyz failed"
    code="$(curl -s -o /dev/null -w '%{http_code}' "${res[@]}" "$base/api/metrics")"
    [[ "$code" == "404" ]] || die "/api/metrics must not be public (got $code)"
    code="$(curl -s -o /dev/null -w '%{http_code}' "${res[@]}" "$base/")"
    [[ "$code" -lt 500 ]] || die "GET / returned $code"
    hsts="$(curl -sI "${res[@]}" "$base/" | grep -i '^strict-transport-security' || true)"
    [[ -n "$hsts" ]] || die "HSTS header missing"
    log "smoke OK over HTTPS"
  else
    log "WARNING: HTTPS not enabled yet (no certificate). Run with --init-cert EMAIL."
    dc exec -T api node -e "fetch('http://127.0.0.1:4000/api/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      || die "api /api/readyz failed"
    log "smoke OK (internal)"
  fi
fi

log "deployed TAG=$TAG"
dc ps
