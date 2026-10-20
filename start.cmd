@echo off
chcp 65001 >nul
cd /d "%~dp0"
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 이상을 설치한 뒤 다시 실행하세요: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules\cheerio (
  call npm ci --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node --use-env-proxy scripts/run-local.mjs
pause
