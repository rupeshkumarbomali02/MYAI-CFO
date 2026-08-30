@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0MVP-FINANCIAL-INTEGRITY-TEST.ps1"
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" pause
exit /b %EXITCODE%
