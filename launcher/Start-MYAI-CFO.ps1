$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$App = Join-Path $Root 'app'
$Node = Join-Path $App 'tools\node-win\node.exe'
$Npm = Join-Path $App 'tools\node-win\npm.cmd'
$Setup = Join-Path $Root 'scripts\setup\setup.ps1'
$BackendDir = Join-Path $App 'backend'
$Backend = Join-Path $BackendDir 'server.mjs'
$FrontendDir = Join-Path $App 'frontend'
$StateDir = Join-Path $App '.myai-cfo'
$LogDir = Join-Path $StateDir 'logs'
$LauncherLog = Join-Path $LogDir 'launcher.log'
$ApiPort = 47821
$WebPort = 47820

# Bootstrap the state tree explicitly. Do not assume that -Force creates missing parents.
# The launcher must be able to log on a completely clean first launch.
try {
  New-Item -ItemType Directory -Force -Path $App | Out-Null
  if(-not (Test-Path -LiteralPath $StateDir -PathType Container)) { New-Item -ItemType Directory -Force -Path $StateDir | Out-Null }
  if(-not (Test-Path -LiteralPath $LogDir -PathType Container)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
  if(-not (Test-Path -LiteralPath $LogDir -PathType Container)) { throw "Could not create launcher log directory: $LogDir" }
} catch {
  Write-Host "MYAI CFO launcher could not initialise its local state directory: $LogDir" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

function Log($m) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m"
  Write-Host $line
  try { Add-Content -LiteralPath $LauncherLog -Value $line -ErrorAction Stop } catch {
    # Logging must never prevent MYAI CFO from starting. Console output remains authoritative.
  }
}
function Fail($m) { Write-Host ''; Write-Host '======================================================================' -ForegroundColor Red; Write-Host ' MYAI CFO COULD NOT START' -ForegroundColor Red; Write-Host '======================================================================' -ForegroundColor Red; Log "ERROR: $m"; Write-Host $m -ForegroundColor Red; Write-Host "Log: $LauncherLog"; Write-Host ''; Read-Host 'Press Enter to close'; exit 1 }
function Kill-Port([int]$port) {
  $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach($processId in $pids) { if($processId -and $processId -ne $PID) { Log "Stopping stale process $processId on port $port"; Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue } }
}

Clear-Host
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ' MYAI CFO - LOCAL FINANCE INTELLIGENCE' -ForegroundColor Cyan
Write-Host '----------------------------------------------------------------------'
Write-Host ' Publisher : Rupeshkumar Bomali, ACCA'
Write-Host ' Email     : rupeshkumar.bomali@gmail.com'
Write-Host ' LinkedIn  : linkedin.com/in/rupeshkumar-bomali-cfo'
Write-Host " Build     : $((Get-Content (Join-Path $Root 'VERSION.txt') -Raw).Trim())"
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ' Local-first | Company-isolated | Evidence-linked | AI Arena | Moni'
Write-Host ''

try {
  if(-not (Test-Path $Node)) {
    Log 'Portable Node.js missing. Running first-time setup.'
    & $Setup
    if(-not (Test-Path $Node)) { Fail "First-time setup returned, but portable Node.js was not installed." }
  }
  if(-not (Test-Path $Node)) { Fail 'Setup completed but portable node.exe was not found.' }
  if(-not (Test-Path $Npm)) { Fail 'Portable npm.cmd was not found.' }

  Log "Portable Node: $(& $Node --version)"
  Log "Portable npm: $(& $Npm --version)"

  if(-not (Test-Path (Join-Path $BackendDir 'node_modules'))) {
    Log 'Backend dependencies missing. Running setup.'
    & $Setup
    if(-not (Test-Path (Join-Path $BackendDir 'node_modules'))) { Fail "Backend setup returned, but backend dependencies are still missing." }
  }
  if(-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    Log 'Frontend dependencies missing. Running setup.'
    & $Setup
    if(-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) { Fail "Frontend setup returned, but frontend dependencies are still missing." }
  }

  $LlamaRoot = Join-Path $App 'llm-backend\win'
  $LlamaCandidates = @(
    (Join-Path $LlamaRoot 'cuda\llama-server.exe'),
    (Join-Path $LlamaRoot 'vulkan\llama-server.exe'),
    (Join-Path $LlamaRoot 'hip\llama-server.exe'),
    (Join-Path $LlamaRoot 'sycl\llama-server.exe'),
    (Join-Path $LlamaRoot 'cpu\llama-server.exe'),
    (Join-Path $LlamaRoot 'llama-server.exe')
  )
  $LlamaReady = $false
  foreach($candidate in $LlamaCandidates) {
    if(Test-Path -LiteralPath $candidate -PathType Leaf) {
      $marker = Join-Path (Split-Path -Parent $candidate) '.release'
      if(Test-Path -LiteralPath $marker -PathType Leaf) {
        $markerValue = (Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue).Trim()
        if($markerValue -eq 'b10516') { $LlamaReady = $true; break }
      }
    }
  }
  if(-not $LlamaReady) {
    Log 'llama.cpp runtime is missing or older than the production-required build. Updating local runtime.'
    $LlamaSetup = Join-Path $Root 'scripts\setup\setup-llama.ps1'
    if(Test-Path -LiteralPath $LlamaSetup) { & $LlamaSetup } else { Log 'WARNING: llama.cpp setup script was not found; existing provider runtimes will be used.' }
  }

  Kill-Port $ApiPort
  Kill-Port $WebPort
  Start-Sleep -Milliseconds 500

  $backendLog = Join-Path $LogDir 'backend.log'
  $backendErr = Join-Path $LogDir 'backend-error.log'
  $frontendLog = Join-Path $LogDir 'frontend.log'
  $frontendErr = Join-Path $LogDir 'frontend-error.log'
  Remove-Item $backendLog,$backendErr,$frontendLog,$frontendErr -Force -ErrorAction SilentlyContinue

  Write-Host 'Starting MYAI CFO services in the background...' -ForegroundColor Cyan
  Write-Host 'Production launcher: services remain supervised until the browser is ready.' -ForegroundColor DarkCyan
  Log "Backend script: $Backend"
  Log "Backend working directory: $BackendDir"
  if($Backend -match '\s') { Log 'Backend path contains spaces; launching with explicit quoting.' }
  Log 'Starting backend process with portable node.exe.'
  $bp = Start-Process -FilePath $Node -WorkingDirectory $BackendDir -ArgumentList @("`"$Backend`"") -RedirectStandardOutput $backendLog -RedirectStandardError $backendErr -WindowStyle Hidden -PassThru
  Log "Backend PID: $($bp.Id)"

  # IMPORTANT: Do not launch npm.cmd via Start-Process. On Windows npm.cmd can
  # resolve its node executable through PATH, which is not guaranteed to contain
  # our portable runtime when spawned this way. Launch Vite directly through the
  # portable node.exe instead.
  $ViteBin = Join-Path $FrontendDir 'node_modules\vite\bin\vite.js'
  if(-not (Test-Path $ViteBin)) { Fail "Vite CLI was not found at $ViteBin. Frontend dependencies are incomplete." }

  Log "Frontend Vite CLI: $ViteBin"
  if($ViteBin -match '\s') { Log 'Frontend path contains spaces; launching with explicit quoting.' }
  Log 'Starting frontend directly with portable node.exe and Vite CLI.'
  $fp = Start-Process -FilePath $Node -WorkingDirectory $FrontendDir -ArgumentList @("`"$ViteBin`"","--host","127.0.0.1","--port","$WebPort") -RedirectStandardOutput $frontendLog -RedirectStandardError $frontendErr -WindowStyle Hidden -PassThru
  Log "Frontend PID: $($fp.Id)"

  $apiReady=$false
  for($i=1;$i -le 45;$i++) {
    Start-Sleep -Seconds 1
    try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:$ApiPort/api/health"; if($r.StatusCode -eq 200){$apiReady=$true;break} } catch {}
    if($bp.HasExited) { $tail='No backend-error.log content.'; if(Test-Path -LiteralPath $backendErr){$tail=Get-Content -LiteralPath $backendErr -Tail 20 -ErrorAction SilentlyContinue | Out-String}; Log "Backend exit code: $($bp.ExitCode)"; Log "Backend stderr: $tail"; Fail "Backend process exited unexpectedly (exit code $($bp.ExitCode)). See $backendLog and $backendErr." }
  }
  if(-not $apiReady) { Fail "Backend health check timed out. See $backendLog and backend-error.log." }

  $webReady=$false
  for($i=1;$i -le 20;$i++) {
    Start-Sleep -Milliseconds 500
    try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 "http://127.0.0.1:$WebPort"; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){$webReady=$true;break} } catch {}
    if($fp.HasExited) { Fail "Frontend process exited unexpectedly. See $frontendLog and frontend-error.log." }
  }
  if(-not $webReady) { Fail "Frontend did not become ready. See $frontendLog and frontend-error.log." }

  Write-Host ''
  Write-Host '======================================================================' -ForegroundColor Green
  Write-Host ' MYAI CFO IS RUNNING' -ForegroundColor Green
  Write-Host '======================================================================' -ForegroundColor Green
  Write-Host " Web UI    : http://127.0.0.1:$WebPort"
  Write-Host " API       : http://127.0.0.1:$ApiPort"
  Write-Host " Backend   : PID $($bp.Id)"
  Write-Host " Frontend  : PID $($fp.Id)"
  Write-Host " Logs      : $LogDir"
  Write-Host '======================================================================' -ForegroundColor Green
  Log 'MYAI CFO is running.'
  Start-Process "http://127.0.0.1:$WebPort"
  Read-Host 'MYAI CFO is running. Press Enter to stop MYAI CFO'
  Log 'Stopping MYAI CFO services.'
  try { if(-not $bp.HasExited){ Stop-Process -Id $bp.Id -Force -ErrorAction SilentlyContinue } } catch {}
  try { if(-not $fp.HasExited){ Stop-Process -Id $fp.Id -Force -ErrorAction SilentlyContinue } } catch {}
}
catch { Fail $_.Exception.Message }
