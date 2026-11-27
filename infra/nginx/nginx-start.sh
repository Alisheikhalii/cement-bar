#!/bin/sh
# nginx container start wrapper (POSIX sh; mounted read-only, executed via /bin/sh).
#  1. Selects which templates to render: the HTTPS server is only enabled once a
#     certificate exists for ${DOMAIN}; before that only HTTP + ACME webroot run.
#  2. Starts a background loop that reloads nginx every 6h to pick up renewed certs.
#  3. Hands over to the official image entrypoint (envsubst of templates, then nginx).
set -eu

: "${DOMAIN:?DOMAIN is required}"
SRC=/opt/cb/templates
DST="${NGINX_ENVSUBST_TEMPLATE_DIR:-/tmp/nginx-templates}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

mkdir -p "$DST"
rm -f "$DST"/*.template
cp "$SRC/http.conf.template" "$DST/"
if [ -f "$CERT" ]; then
  cp "$SRC/https.conf.template" "$DST/"
  echo "[nginx-start] TLS certificate found for ${DOMAIN}: HTTPS enabled"
else
  echo "[nginx-start] WARNING: no certificate at ${CERT}; serving HTTP (ACME + redirect) only." >&2
  echo "[nginx-start] Issue one with: infra/scripts/deploy.sh --init-cert, then restart nginx." >&2
fi

(
  while :; do
    sleep 21600
    nginx -s reload 2>/dev/null || true
  done
) &

exec /docker-entrypoint.sh nginx -g 'daemon off;'
