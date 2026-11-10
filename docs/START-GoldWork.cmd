@echo off
setlocal
rem Copy this file to E:\GoldWorkStudio\START-GoldWork.cmd after a successful build.
set "GWS_SOURCE_DIR=E:\GoldWorkStudio\worktrees\critical-recovery"
if not exist "%GWS_SOURCE_DIR%\package.json" (
  echo Gold Work Studio source is missing: "%GWS_SOURCE_DIR%"
  pause
  exit /b 1
)
echo Gold Work Studio source: "%GWS_SOURCE_DIR%"
call "%GWS_SOURCE_DIR%\START-GoldWork-E.cmd"
exit /b %errorlevel%
