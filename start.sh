#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo 'Node.js 22 이상을 먼저 설치해 주세요.'; exit 1; }
npm ci
printf '\n브라우저에서 http://localhost:3000 을 여세요. 종료: Ctrl+C\n\n'
npm start
