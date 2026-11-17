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
set "AIMATTERLAB_EXIT_CODE=%ERRORLEVEL%"
if not "%AIMATTERLAB_EXIT_CODE%"=="0" (
  echo AIMatterLab could not start ^(exit %AIMATTERLAB_EXIT_CODE%^). Review the error above; your profile was preserved.
  pause
  exit /b %AIMATTERLAB_EXIT_CODE%
)
exit /b 0
