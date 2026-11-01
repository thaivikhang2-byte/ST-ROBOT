@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js de chay. Neu da cai, mo lai cua so nay.
  pause
  exit /b 1
)
node "%~dp0start-web.cjs"
pause
