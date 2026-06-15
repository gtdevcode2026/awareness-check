@echo off
title Security Awareness App
cd /d "%~dp0awareness"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required to run this app.
  echo   Install the LTS version from https://nodejs.org
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\serve" (
  echo Installing dependencies the first time, please wait...
  call npm install
)

echo.
echo   Starting the app... it will open in your browser.
echo   Keep this window open while using the app. Close it to stop.
echo.

rem open the browser a couple of seconds after the server starts
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul && explorer http://127.0.0.1:4173"

call npm run serve:static
