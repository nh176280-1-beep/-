@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "APP_NODE=node"
if exist "%~dp0runtime\node.exe" set "APP_NODE=%~dp0runtime\node.exe"
"%APP_NODE%" "%~dp0reset-admin.mjs"
echo.
pause
