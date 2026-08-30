param(
  [Parameter(Mandatory=$true)][ValidateSet('CERT-004C','CERT-004D','CERT-005','CERT-005A','CERT-006','CERT-008','CERT-008B','CERT-009')][string]$Stage,
  [Parameter(Mandatory=$true)][string]$ApiBase,
  [string]$VisibleApiBase=$ApiBase,
  [string]$FrontendUrl='',
  [string]$JobId=("independent-"+(Get-Date -Format 'yyyyMMdd-HHmmss')),
  [string]$BuildRoot=(Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference='Stop'
$node=Join-Path $BuildRoot 'app\tools\node-win\node.exe'
$npm=Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
if(-not $npm){$npm=Get-Command npm.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source}
if(-not(Test-Path $node)){throw "Bundled Node.js not found: $node"}
if(-not $ApiBase){throw 'ApiBase is required.'}
$env:MYAI_BASE_URL=$ApiBase; $env:MYAI_CFO_API_PORT=([uri]$ApiBase).Port; $env:MYAI_CFO_CERT_JOB_ID=$JobId; $env:MYAI_CFO_VISIBLE_API_BASE=$VisibleApiBase
$logDir=Join-Path $BuildRoot "qa\results\independent-$JobId"; New-Item -ItemType Directory -Force $logDir | Out-Null
function Run-Node([string[]]$Args,[string]$Name){& $node @Args 2>&1 | Tee-Object -FilePath (Join-Path $logDir "$Name.log"); if($LASTEXITCODE -ne 0){throw "$Name failed with exit code $LASTEXITCODE."}}
switch($Stage){
 'CERT-004C' { Run-Node @((Join-Path $BuildRoot 'qa\tests\synthetic-cfo-e2e.mjs'),'--apiBase',$ApiBase,'--visibleApiBase',$VisibleApiBase,'--jobId',$JobId) 'cert-004c' }
 'CERT-004D' { Run-Node @((Join-Path $BuildRoot 'qa\tests\comprehensive-financial-certification.mjs'),'--apiBase',$ApiBase) 'cert-004d' }
 'CERT-005'  { Run-Node @((Join-Path $BuildRoot 'qa\run-production-assurance.mjs')) 'cert-005' }
 'CERT-005A' { Run-Node @((Join-Path $BuildRoot 'qa\tests\synthetic-cfo-scenario.mjs')) 'cert-005a' }
 'CERT-006'  { Run-Node @((Join-Path $BuildRoot 'qa\tests\live-certification.mjs'),'--apiBase',$ApiBase,'--jobId',$JobId) 'cert-006' }
 'CERT-008'  {
    if(-not $FrontendUrl){throw 'CERT-008 requires -FrontendUrl pointing at the running production preview UI.'}
    $env:MYAI_FRONTEND_URL=$FrontendUrl; $env:MYAI_CFO_UI_BASE=$FrontendUrl; $env:MYAI_CFO_UI_URL=$FrontendUrl
    Run-Node @('node_modules\@playwright\test\cli.js','test','qa/browser/critical-buttons.spec.mjs','qa/browser/all-buttons.spec.mjs','qa/browser/holistic-platform.spec.mjs','--reporter=line') 'cert-008'
  }
 'CERT-008B' { Run-Node @((Join-Path $BuildRoot 'qa\tests\audit-forensics-suite.mjs'),(Join-Path $BuildRoot 'app\.myai-cfo\audit\acceptance.jsonl')) 'cert-008b' }
 'CERT-009'  { $env:MYAI_CFO_CERT_JOB_ID=$JobId; Run-Node @((Join-Path $BuildRoot 'qa\release-gate.mjs')) 'cert-009' }
}
Write-Host "INDEPENDENT $Stage COMPLETED (stage-isolated; does not determine final Production GO)" -ForegroundColor Green
