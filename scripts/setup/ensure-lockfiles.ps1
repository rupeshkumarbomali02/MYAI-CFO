param([string]$RootDir)
$ErrorActionPreference='Stop'
if(-not $RootDir){$RootDir=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path}
$apps=@('app\backend','app\frontend')
foreach($rel in $apps){
  $dir=Join-Path $RootDir $rel
  $npm=Join-Path $RootDir 'app\tools\node-win\npm.cmd'
  if(-not (Test-Path $npm)){ $npm='npm' }
  Push-Location $dir
  try{
    & $npm install --package-lock-only --ignore-scripts --no-audit --no-fund --package-lock=true
    if($LASTEXITCODE -ne 0){ throw "package-lock generation failed for $rel (exit $LASTEXITCODE)" }
    if(-not (Test-Path 'package-lock.json')){ throw "package-lock.json was not created for $rel" }
    $hash=(Get-FileHash -LiteralPath 'package-lock.json' -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host "LOCKFILE $rel $hash" -ForegroundColor Green
  } finally { Pop-Location }
}
