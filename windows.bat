@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title MYAI CFO - Local Finance Intelligence
if /I "%~1"=="extract" (
  shift
  call "%~dp0launcher\Extract-Document.bat" %*
  exit /b %ERRORLEVEL%
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '%~dp0launcher\Start-MYAI-CFO.ps1'"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo MYAI CFO launcher exited with code %RC%.
  pause
)
endlocal
