@echo off
setlocal
title MYAI CFO - Setup
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\setup\setup.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Setup failed. This window will remain open.
  pause
  exit /b 1
)
echo.
echo Setup completed successfully.
echo You can now run Start-MYAI-CFO.bat
echo.
pause
endlocal
