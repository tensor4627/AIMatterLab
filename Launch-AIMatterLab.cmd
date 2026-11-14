@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js and pnpm, then run this file again.
  pause
  exit /b 1
)
node "%~dp0scripts\source-start.mjs" %*
if errorlevel 1 (
  echo AIMatterLab could not start. Review the error above; your profile was preserved.
  pause
  exit /b 1
)
