#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"; then
  echo 'Node.js 24 이상을 설치하세요: https://nodejs.org/'
  exit 1
fi
if [ ! -d node_modules/cheerio ]; then
  npm ci --omit=dev --no-audit --no-fund || exit 1
fi
exec node --use-env-proxy scripts/run-local.mjs
