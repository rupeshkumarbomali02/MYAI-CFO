$ErrorActionPreference='Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$tests = @(
  'qa/tests/v46-remediated-financial-integrity.mjs',
  'qa/tests/comparative-period-extraction-regression.mjs',
  'qa/tests/latest-period-selection-regression.mjs',
  'qa/tests/holistic-cfo-matrix.mjs',
  'qa/tests/financial-consistency.mjs',
  'qa/tests/financial-spine-safety.mjs',
  'qa/tests/synthetic-fixture-extraction.mjs',
  'qa/tests/v45-regression.mjs',
  'qa/tests/rag-citation-contract-static.mjs',
  'qa/tests/cert005-retrieval-isolation-static.mjs',
  'qa/tests/security-regression.mjs',
  'qa/tests/ai-security-regression.mjs',
  'qa/tests/model-lifecycle-contract.mjs'
)
Write-Host 'MY AI CFO — V46 REMEDIATED MVP TEST SUITE' -ForegroundColor Cyan
Write-Host "Root: $Root"
node --version
python --version
$failed = @()
foreach($test in $tests){
  Write-Host "`n===== $test =====" -ForegroundColor DarkCyan
  node $test
  if($LASTEXITCODE -ne 0){ $failed += $test }
}
# Source sanity must run on a clean QA-results directory; it ignores its own transient output.
if(Test-Path 'qa/results'){ Remove-Item -Recurse -Force 'qa/results' }
$env:MYAI_CFO_SOURCE_SANITY_SELF_RUN='1'
Write-Host "`n===== qa/tests/source-workflow-sanity.mjs =====" -ForegroundColor DarkCyan
node 'qa/tests/source-workflow-sanity.mjs'
if($LASTEXITCODE -ne 0){ $failed += 'qa/tests/source-workflow-sanity.mjs' }
Remove-Item Env:MYAI_CFO_SOURCE_SANITY_SELF_RUN -ErrorAction SilentlyContinue
# Package-safety is evaluated after generated result cleanup, exactly as the release package should be checked.
if(Test-Path 'qa/results'){ Remove-Item -Recurse -Force 'qa/results' }
Write-Host "`n===== qa/tests/package-safety.mjs =====" -ForegroundColor DarkCyan
node 'qa/tests/package-safety.mjs'
if($LASTEXITCODE -ne 0){ $failed += 'qa/tests/package-safety.mjs' }
if(Test-Path 'qa/results'){ Remove-Item -Recurse -Force 'qa/results' }

if($failed.Count -eq 0){
  Write-Host "`nMVP RESULT: PASS" -ForegroundColor Green
  Write-Host 'Financial integrity, comparative-period, extraction, ratio/KPI, Knowledge Hub, security and source-workflow regression checks passed.' -ForegroundColor Green
  exit 0
}
Write-Host "`nMVP RESULT: FAIL" -ForegroundColor Red
Write-Host 'Failed suites:' -ForegroundColor Red
$failed | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
exit 1
