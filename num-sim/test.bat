@echo off
setlocal
cd /d "%~dp0"
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\ohmygame\resources\runtime\node\node.exe" set "NODE=%LOCALAPPDATA%\Programs\ohmygame\resources\runtime\node\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE (
  echo [num-sim] Node.js not found.
  pause
  exit /b 1
)
"%NODE%" --no-warnings --experimental-vm-modules tests\check-modules.mjs || goto :fail
"%NODE%" tests\selftest.mjs || goto :fail
echo.
echo ALL TESTS PASSED
pause
exit /b 0
:fail
echo.
echo TESTS FAILED
pause
exit /b 1
