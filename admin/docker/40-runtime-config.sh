#!/bin/sh
# Writes the runtime config the SPA fetches at startup (/config.json).
# Everything environment-specific arrives here at deploy time; the image
# itself carries no environment, secret or API URL.
set -eu

: "${ADMIN_ENVIRONMENT:?ADMIN_ENVIRONMENT is required (local, dev or prod)}"
: "${ADMIN_API_UPSTREAM:?ADMIN_API_UPSTREAM is required (backend origin without a trailing slash)}"

APP_VERSION="${ADMIN_APP_VERSION:-unknown}"
# The Google client id is public by definition, and empty until the admin
# sign-in flow is deployed.
GOOGLE_CLIENT_ID="${ADMIN_GOOGLE_CLIENT_ID:-}"

cat > /usr/share/nginx/html/config.json <<EOF
{
  "environment": "${ADMIN_ENVIRONMENT}",
  "apiBasePath": "/api",
  "googleClientId": "${GOOGLE_CLIENT_ID}",
  "appVersion": "${APP_VERSION}"
}
EOF
