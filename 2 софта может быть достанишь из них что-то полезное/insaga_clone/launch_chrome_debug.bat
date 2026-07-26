@echo off
echo ============================================
echo   insaga.net CDP Capture Launcher
echo ============================================
echo.
echo This will open Chrome with debug mode enabled.
echo Close ALL Chrome windows first!
echo.
pause

echo.
echo Starting Chrome with remote debugging...
echo.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" https://insaga.net

echo Chrome opened! Log in to insaga.net, then run capture_pipeline.mjs
echo.
pause
