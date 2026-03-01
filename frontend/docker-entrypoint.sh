#!/bin/sh
# Runtime environment injection for Vite apps served by nginx.
# Generates config.js from container env vars so the browser
# can read config that wasn't available at build time.
set -e

cat <<EOF > /usr/share/nginx/html/config.js
window.__env__ = {
  KK_API_URL: "${KK_API_URL:-}",
  KK_ACME_AUTH_ZONE_DOMAIN: "${KK_ACME_AUTH_ZONE_DOMAIN:-}"
};
EOF

exec "$@"
