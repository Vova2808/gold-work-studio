@echo off
echo ============================================
echo   insaga Pipeline Capture - FULL LAUNCHER
echo ============================================
echo.
echo This will CLOSE all Chrome windows and reopen
echo Chrome with debug mode enabled.
echo.
echo Make sure you saved anything in Chrome!
echo.
pause

echo.
echo [1/3] Closing Chrome...
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/3] Opening Chrome with debug mode on port 9222...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" https://insaga.net

timeout /t 3 /nobreak >nul

echo [3/3] Starting capture script...
echo.
cd /d D:\insaga_clone
node capture_pipeline.mjs
