@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Please install Node.js 22 or newer first.
 pause
 exit /b 1
)
call npm ci
if errorlevel 1 (
 pause
 exit /b 1
)
echo Open http://localhost:3000 in your browser. Stop: Ctrl+C
call npm start
pause
