$ErrorActionPreference = "Stop"
$Version = (Get-Content (Join-Path $PSScriptRoot "..\..\VERSION.txt") -Raw).Trim()
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$App = Join-Path $Root "app"
$Tools = Join-Path $App "tools\node-win"
$Node = Join-Path $Tools "node.exe"
$Npm = Join-Path $Tools "npm.cmd"
$NodeVersion = "24.19.0"
$ArchiveName = "node-v$NodeVersion-win-x64.zip"
$DownloadUrl = "https://nodejs.org/dist/v$NodeVersion/$ArchiveName"
$ExpectedSha256 = "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73"
$CacheDir = Join-Path $App "cache"
$Archive = Join-Path $CacheDir $ArchiveName
$LogDir = Join-Path $App ".myai-cfo\logs"
$AuditDir = Join-Path $App ".myai-cfo\audit"
$InstallIdFile = Join-Path $App ".myai-cfo\install.id"
$Temp = Join-Path $env:TEMP ("MYAI-CFO-node-" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Force -Path $CacheDir,$LogDir,$AuditDir | Out-Null
Start-Transcript -Path (Join-Path $LogDir "setup-transcript.log") -Append | Out-Null

try {
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host " MYAI CFO - LOCAL FINANCE INTELLIGENCE | FIRST-TIME SETUP" -ForegroundColor Cyan
    Write-Host "----------------------------------------------------------------------"
    Write-Host " Publisher : Rupeshkumar Bomali, ACCA"
    Write-Host " Email     : rupeshkumar.bomali@gmail.com"
    Write-Host " LinkedIn  : linkedin.com/in/rupeshkumar-bomali-cfo"
    Write-Host " Build     : $Version"
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host ""

    if (-not (Test-Path $Node)) {
        Write-Host "[1/4] Portable Node.js not found." -ForegroundColor Yellow
        Write-Host "      Downloading Node.js $NodeVersion x64 from the official Node.js distribution..."
        if (-not (Test-Path $Archive)) {
            Invoke-WebRequest -Uri $DownloadUrl -OutFile $Archive -UseBasicParsing
        }
        Write-Host "      Verifying SHA-256..."
        $actual = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $ExpectedSha256) {
            throw "Node.js archive SHA-256 mismatch. Expected $ExpectedSha256 but received $actual."
        }
        Write-Host "      Extracting portable Node.js..."
        if (Test-Path $Temp) { Remove-Item -Recurse -Force $Temp }
        New-Item -ItemType Directory -Force -Path $Temp | Out-Null
        Expand-Archive -LiteralPath $Archive -DestinationPath $Temp -Force
        $Extracted = Join-Path $Temp "node-v$NodeVersion-win-x64"
        if (-not (Test-Path (Join-Path $Extracted "node.exe"))) {
            throw "Portable Node.js extraction did not contain node.exe."
        }
        if (Test-Path $Tools) { Remove-Item -Recurse -Force $Tools }
        New-Item -ItemType Directory -Force -Path (Split-Path $Tools) | Out-Null
        Move-Item -Path $Extracted -Destination $Tools
        Remove-Item -Recurse -Force $Temp -ErrorAction SilentlyContinue
    } else {
        Write-Host "[1/4] Portable Node.js already installed."
    }

    if (-not (Test-Path $Node)) { throw "Portable Node.js is missing after setup." }
    if (-not (Test-Path $Npm)) { throw "Portable npm is missing after setup." }

    Write-Host "[2/4] Portable runtime:"
    & $Node --version
    if ($LASTEXITCODE -ne 0) { throw "Portable Node runtime failed." }
    & $Npm --version
    if ($LASTEXITCODE -ne 0) { throw "Portable npm failed." }

    Write-Host "[3/6] Installing backend dependencies..."
    Push-Location (Join-Path $App "backend")
    & $Npm install --no-audit --no-fund --progress=false
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Backend npm install failed with exit code $LASTEXITCODE." }
    Pop-Location

    Write-Host "[4/6] Installing frontend dependencies..."
    Push-Location (Join-Path $App "frontend")
    & $Npm install --no-audit --no-fund --progress=false
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Frontend npm install failed with exit code $LASTEXITCODE." }
    Pop-Location

    Write-Host "[5/6] Installing optional PDF visual/table extraction dependencies..."
    $PythonCmd = $null
    foreach ($candidate in @("py","python","python3")) { try { & $candidate --version *> $null; if ($LASTEXITCODE -eq 0) { $PythonCmd = $candidate; break } } catch {} }
    if ($PythonCmd) {
        try { & $PythonCmd -m pip install --user --disable-pip-version-check --no-input PyMuPDF pdfplumber docling openpyxl pandas python-calamine trafilatura arelle-release; if ($LASTEXITCODE -ne 0) { Write-Host "      PDF visual extraction packages could not be installed; text extraction will remain available." -ForegroundColor Yellow } else { Write-Host "      PDF visual/table extraction ready." -ForegroundColor Green } } catch { Write-Host "      Optional PDF extraction setup skipped: $($_.Exception.Message)" -ForegroundColor Yellow }
    } else { Write-Host "      Python not detected. PDF text extraction remains available; install Python + PyMuPDF/pdfplumber later for visual/table extraction." -ForegroundColor Yellow }

    Write-Host "[6/7] Installing local llama.cpp text runtime..."
    $LlamaSetup = Join-Path $PSScriptRoot 'setup-llama.ps1'
    if (Test-Path $LlamaSetup) { & $LlamaSetup; if ($LASTEXITCODE -ne 0) { Write-Host '      llama.cpp setup failed; continuing with Ollama/other runtimes.' -ForegroundColor Yellow } }

    Write-Host "[lock] Generating deterministic npm lockfiles..." -ForegroundColor Cyan
    $LockSetup = Join-Path $PSScriptRoot 'ensure-lockfiles.ps1'
    if(Test-Path $LockSetup){ & $LockSetup -RootDir $Root; if($LASTEXITCODE -ne 0){ throw 'Lockfile generation failed. Setup cannot certify dependency reproducibility.' } }

    Write-Host "[7/7] Installing official Ollama Windows runtime..." -ForegroundColor Cyan
    $OllamaCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
        (Join-Path $env:LOCALAPPDATA "Ollama\ollama.exe")
    )
    $OllamaExe = $OllamaCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $OllamaExe) {
        try {
            $OllamaInstallScript = Join-Path $env:TEMP "myai-cfo-ollama-install.ps1"
            Invoke-WebRequest -Uri "https://ollama.com/install.ps1" -OutFile $OllamaInstallScript -UseBasicParsing
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $OllamaInstallScript
            if ($LASTEXITCODE -ne 0) { throw "Ollama installer exited with code $LASTEXITCODE." }
            Write-Host "      Ollama installed through the official Windows installer." -ForegroundColor Green
        } catch {
            Write-Host "      Ollama installation could not be completed automatically: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "      MYAI CFO will continue with llama.cpp. Ollama can be repaired from AI Models." -ForegroundColor Yellow
        }
    } else {
        Write-Host "      Ollama already installed: $OllamaExe" -ForegroundColor Green
    }

    if (-not (Test-Path $InstallIdFile)) { [guid]::NewGuid().ToString() | Set-Content -NoNewline $InstallIdFile }
    try { attrib +h (Join-Path $App ".myai-cfo") 2>$null | Out-Null } catch {}

    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Green
    Write-Host " MYAI CFO SETUP COMPLETE" -ForegroundColor Green
    Write-Host " Portable runtime installed inside the application."
    Write-Host " No system Node.js installation is required."
    Write-Host " Setup log: app\.myai-cfo\logs\setup-transcript.log"
    Write-Host "======================================================================" -ForegroundColor Green
    return
}
catch {
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Red
    Write-Host " MYAI CFO SETUP FAILED" -ForegroundColor Red
    Write-Host " $($_.Exception.Message)" -ForegroundColor Red
    Write-Host " Setup log: app\.myai-cfo\logs\setup-transcript.log"
    Write-Host "======================================================================" -ForegroundColor Red
    throw
}
finally {
    Stop-Transcript | Out-Null
}
