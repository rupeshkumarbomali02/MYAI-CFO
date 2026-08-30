@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
if "%~1"=="" (
  echo Usage: Extract-Document.bat "C:\path\to\document.pdf" [output.json]
  exit /b 2
)
set "INPUT=%~1"
if "%~2"=="" (set "OUTPUT=%~dpn1.myaicfo-extraction.json") else (set "OUTPUT=%~2")
set "PY="
where py >nul 2>nul && set "PY=py"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3.10+ is required. Run launcher\Install-Dependencies.bat first.
  exit /b 3
)
echo.
echo MYAI CFO parallel extraction
 echo Input:  %INPUT%
 echo Output: %OUTPUT%
 echo.
%PY% scripts\extraction\document_ensemble.py --input "%INPUT%" --output "%OUTPUT%"
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" echo Extraction complete. Open %OUTPUT%
exit /b %RC%
