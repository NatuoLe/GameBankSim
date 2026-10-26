@echo off
setlocal
cd /d "%~dp0"
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\ohmygame\resources\runtime\node\node.exe" set "NODE=%LOCALAPPDATA%\Programs\ohmygame\resources\runtime\node\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE (
  echo [num-sim] Node.js not found. Install from https://nodejs.org or add node to PATH.
  pause
  exit /b 1
)
if "%PORT%"=="" set "PORT=8787"
start "" "http://localhost:%PORT%"
"%NODE%" server.js
pause
