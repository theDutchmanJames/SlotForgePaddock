@echo off
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing desktop dependencies...
  call npm.cmd ci
  if errorlevel 1 exit /b 1
  node node_modules\electron\install.js
  if errorlevel 1 exit /b 1
)
call npm.cmd start
