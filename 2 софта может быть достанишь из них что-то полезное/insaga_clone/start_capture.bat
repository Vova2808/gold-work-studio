@echo off
echo ============================================
echo   insaga.net Pipeline Capture
echo ============================================
echo.
echo Make sure Chrome is open with debug mode!
echo (run launch_chrome_debug.bat first)
echo.
pause

cd /d D:\insaga_clone
node capture_pipeline.mjs
