@echo off
REM ============================================================
REM  StormSafe CRM launcher
REM
REM  Opens the CRM as a desktop window using Electron's OWN signed
REM  binary (node_modules\electron\dist\electron.exe) instead of the
REM  repackaged "StormSafe CRM.exe". The repackaged exe is unsigned, so
REM  Windows "Smart App Control" blocks it on fresh Windows 11 machines.
REM  The stock electron.exe IS signed (by the Electron project) and runs
REM  fine under Smart App Control — same app window, no security change.
REM
REM  Make a desktop shortcut to THIS file and you're set.
REM ============================================================

cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies (one time)...
  call npm install
)

if not exist "dist\index.html" (
  echo Building the app (one time)...
  call npm run build
)

set ELECTRON_SERVE_DIST=1
start "" "node_modules\electron\dist\electron.exe" .
