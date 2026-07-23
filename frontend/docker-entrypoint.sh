#!/bin/sh
set -eu

: "${VITE_API_URL:?VITE_API_URL precisa estar definida no serviço de frontend da Railway.}"

escaped_api_url=$(printf '%s' "$VITE_API_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__POKA_PRATIKA_CONFIG__ = {
  VITE_API_URL: "$escaped_api_url"
};
EOF

exec nginx -g 'daemon off;'
