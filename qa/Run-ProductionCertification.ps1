param(
  [string]$RootDir,
  [string]$JobId = $env:MYAI_CFO_CERT_JOB_ID,
  [string]$ApiBase = $env:MYAI_CFO_CERT_API_BASE
)
$ErrorActionPreference = 'Stop'
if (-not $RootDir) { $RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not $JobId) { $JobId = "manual-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())" }
# API base is supplied by the certification core once its isolated backend is started.

function Ensure-Directory {
  param([Parameter(Mandatory)][string]$Path)
  try {
    New-Item -ItemType Directory -Force -Path $Path -ErrorAction Stop | Out-Null
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "Directory was not created." }
    return $true
  } catch {
    return $false
  }
}
$preferredMain = Join-Path $RootDir 'app\data\diagnostics\production-certification'
$preferredQa = Join-Path $RootDir 'qa\results\production-certification'
$tempRoot = if ($env:MYAI_CFO_CERT_REPORT_ROOT) { $env:MYAI_CFO_CERT_REPORT_ROOT } else { Join-Path ([IO.Path]::GetTempPath()) 'MYAI-CFO-Certification-Reports' }
$mainCandidates=@($preferredMain,(Join-Path $tempRoot 'application'))
$qaCandidates=@($preferredQa,(Join-Path $tempRoot 'qa'))
$mainRoot=$mainCandidates | Where-Object { Ensure-Directory $_ } | Select-Object -First 1
$qaRoot=$qaCandidates | Where-Object { Ensure-Directory $_ } | Select-Object -First 1
if(-not $mainRoot -or -not $qaRoot){ throw "Unable to create certification report directories. Root=$RootDir; main=$preferredMain; qa=$preferredQa; temp=$tempRoot" }
$env:MYAI_CFO_CERT_REPORT_ROOT=[string]$mainRoot
$env:MYAI_CFO_CERT_QA_REPORT_ROOT=[string]$qaRoot
$reportRoots=@($mainRoot,$qaRoot)
$mainReport=Join-Path $mainRoot $JobId
$qaReport=Join-Path $qaRoot $JobId
if(-not (Ensure-Directory $mainReport)){ throw "Certification report directory could not be created: $mainReport" }
if(-not (Ensure-Directory $qaReport)){ throw "QA report directory could not be created: $qaReport" }
$launcherLog = Join-Path $mainReport 'certification-launcher.log'
[System.IO.File]::WriteAllText($launcherLog, "MYAI CFO certification launcher START $JobId", (New-Object System.Text.UTF8Encoding($false)))

function Write-LauncherReport {
  param([string]$Status, [string]$Reason, [int]$ExitCode)
  $payload = [ordered]@{
    schemaVersion = '3.0'
    reportType = 'MYAI_CFO_PRODUCTION_CERTIFICATION'
    applicationVersion = (Get-Content (Join-Path $RootDir 'VERSION.txt') -Raw).Trim()
    jobId = $JobId
    generatedAt = [DateTime]::UtcNow.ToString('o')
    status = $Status
    reason = $Reason
    exitCode = $ExitCode
    reportDirectory = $mainReport
    qaReportDirectory = $qaReport
    launcherLog = $launcherLog
    coreScript = (Join-Path $PSScriptRoot 'Run-ProductionCertification-Core.ps1')
    reportRoot = $mainRoot
    qaReportRoot = $qaRoot
  }
  $json = $payload | ConvertTo-Json -Depth 20
  $json | Set-Content -Encoding UTF8 (Join-Path $mainReport 'production-certification.json')
  $json | Set-Content -Encoding UTF8 (Join-Path $qaReport 'production-certification.json')
  @(
    '# MYAI CFO - Production Certification'
    ''
    "- Application: $($payload.applicationVersion)"
    "- Job ID: $JobId"
    "- Status: $Status"
    "- Exit code: $ExitCode"
    "- Generated: $($payload.generatedAt)"
    "- Reason: $Reason"
    "- Report directory: $mainReport"
    "- QA report directory: $qaReport"
    ''
    '## Forensic files'
    "- production-certification.json"
    "- certification-launcher.log"
    '- core-output.log (when created)'
    '- core-error.log (when created)'
    '- step-*.json (when created)'
  ) | Set-Content -Encoding UTF8 (Join-Path $mainReport 'production-certification.md')
}


# Fresh-run boundary is established BEFORE the preflight. Only generated certification artifacts are removed; normal CFO data is preserved.
$stalePreflight = @(
  (Join-Path $RootDir 'qa\results\certification-harness-preflight.json'),
  (Join-Path $RootDir 'qa\results\production-assurance-latest.json'),
  (Join-Path $RootDir 'qa\results\live-certification-latest.json'),
  (Join-Path $RootDir 'qa\results\synthetic-cfo-latest.json'),
  (Join-Path $RootDir 'qa\results\synthetic-evidence-latest.json'),
  (Join-Path $RootDir 'qa\results\playwright-results.json'),
  (Join-Path $RootDir 'qa\results\audit-forensics-latest.json'),
  (Join-Path $RootDir 'qa\results\production-certification-latest.json')
)
foreach($target in $stalePreflight){ try { if(Test-Path -LiteralPath $target -PathType Leaf){ Remove-Item -LiteralPath $target -Force -ErrorAction Stop } } catch { throw "Unable to establish fresh certification boundary for ${target}: $($_.Exception.Message)" } }

$plan = @(@{stepId='CERT-HARNESS';name='Certification harness integrity preflight'},@{stepId='CERT-000B';name='Source and workflow sanity regression'},@{stepId='CERT-000';name='Windows build prerequisites'},@{stepId='CERT-000A';name='Create isolated certification sandbox'},@{stepId='CERT-001';name='Generate genuine npm lockfiles'},@{stepId='CERT-002';name='Clean backend npm ci'},@{stepId='CERT-003';name='Clean frontend npm ci'},@{stepId='CERT-004';name='Production Vite build'},@{stepId='CERT-004A';name='Certification backend lifecycle start'},@{stepId='CERT-0040';name='Visible synthetic CFO evidence seed'},@{stepId='CERT-004B';name='Mandatory synthetic CFO evidence provisioning'},@{stepId='CERT-005';name='Static/security/backend assurance'},@{stepId='CERT-005A';name='Synthetic CFO financial scenario matrix'},@{stepId='CERT-006';name='Live two-model/RAG/agent certification'},@{stepId='CERT-007';name='Production browser preview launch'},@{stepId='CERT-008A';name='Playwright browser runtime'},@{stepId='CERT-008';name='Playwright production E2E'},@{stepId='CERT-008B';name='Audit trail forensic verification'},@{stepId='CERT-009';name='Release assurance and final gate'})
$plan | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 (Join-Path $mainReport 'certification-plan.json')
$plan | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 (Join-Path $qaReport 'certification-plan.json')

$core = Join-Path $PSScriptRoot 'Run-ProductionCertification-Core.ps1'
if (-not (Test-Path $core)) {
  Write-LauncherReport 'HOLD' 'Certification core script is missing.' 1
  throw 'Certification core script is missing.'
}

try {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $core -RootDir $RootDir -JobId $JobId -ApiBase $ApiBase *>&1 | Tee-Object -FilePath (Join-Path $mainReport 'core-output.log') -Append | Out-Host
  $exit = $LASTEXITCODE
  if ($exit -ne 0) {
    Write-LauncherReport 'HOLD' "Certification core exited with code $exit. See core-output.log." $exit
    exit $exit
  }
  Write-LauncherReport 'COMPLETED' 'Certification core completed. See detailed step report.' 0
  exit 0
}
catch {
  $msg = $_.Exception.Message
  Add-Content -Encoding UTF8 -Path $launcherLog -Value "LAUNCHER ERROR: $msg"
  Write-LauncherReport 'HOLD' $msg 1
  try {
    $body = @{ jobId = $JobId; stepId = 'CERT-LAUNCH'; name = 'Certification launcher'; status = 'FAIL'; reason = $msg; durationMs = 0; exitCode = 1 } | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method Post -Uri "$ApiBase/api/audit/certification-event" -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
  } catch {}
  throw
}
