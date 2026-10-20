@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo Starting actual price board...
set "APP_NODE=node"
if exist "%~dp0runtime\node.exe" set "APP_NODE=%~dp0runtime\node.exe"
"%APP_NODE%" -e "if(Number(process.versions.node.split('.')[0])<24 || !process.allowedNodeEnvironmentFlags.has('--use-env-proxy'))process.exit(1)" 2>startup-error.log
if errorlevel 1 goto node_error
if exist node_modules\cheerio goto run_app
echo Installing application dependencies...
call npm ci --omit=dev --no-audit --no-fund 2>>startup-error.log
if errorlevel 1 goto install_error
:run_app
"%APP_NODE%" --use-env-proxy scripts/run-local.mjs 2>>startup-error.log
if errorlevel 1 goto app_error
goto finish
:node_error
echo Node.js runtime is missing or too old. Use the Windows portable ZIP.
goto show_error
:install_error
echo Dependency installation failed. Use the Windows portable ZIP.
goto show_error
:app_error
echo The app could not start. Error details:
:show_error
type startup-error.log
echo.
echo Keep this window open and share the error text above.
:finish
pause
