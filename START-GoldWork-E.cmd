@echo off
setlocal
set "GWS_WORKSPACE_ROOT=E:\GoldWorkStudio"
set "GWS_USER_DATA_DIR=%GWS_WORKSPACE_ROOT%\data\profile"
set "GOLD_WORK_TEMP_DIR=%GWS_WORKSPACE_ROOT%\cache\temp"
set "TEMP=%GWS_WORKSPACE_ROOT%\cache\temp"
set "TMP=%GWS_WORKSPACE_ROOT%\cache\temp"
set "PORTABLE_EXECUTABLE_DIR="
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_RENDERER_URL="
set "GWS_BACKGROUND_TEST="
cd /d "%~dp0"
if not exist "%GWS_USER_DATA_DIR%\storage-location.json" (
  echo The migrated E-drive profile is missing. No application was started.
  pause
  exit /b 1
)
if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "apps\desktop\dist\main\index.cjs" (
  echo Build this source first: pnpm build
  pause
  exit /b 1
)
node scripts\launch-desktop.mjs
if errorlevel 1 (
  echo Gold Work Studio could not start. The error is shown above.
  pause
  exit /b 1
)
