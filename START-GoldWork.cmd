@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js, then reopen this window.
  pause
  exit /b 1
)
node scripts\launch-desktop.mjs
if errorlevel 1 (
  echo.
  echo GoldWork could not start. The error is shown above.
  pause
  exit /b 1
)
