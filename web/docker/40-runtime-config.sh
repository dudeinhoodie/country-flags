#!/bin/sh
# Writes the runtime config the page fetches at startup (/config.json).
# The variables were already checked by 10-site-robots.envsh; this only
# turns them into the file the page reads.
set -eu

: "${SITE_ENVIRONMENT:?SITE_ENVIRONMENT is required (local, dev or prod)}"

APP_VERSION="${SITE_APP_VERSION:-unknown}"

cat > /usr/share/nginx/html/config.json <<EOF
{
  "environment": "${SITE_ENVIRONMENT}",
  "appVersion": "${APP_VERSION}"
}
EOF
