@echo off
setlocal
cd /d "%~dp0"
title MYAI CFO - Local Finance Intelligence
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0Start-MYAI-CFO.ps1'"
if errorlevel 1 pause
endlocal
