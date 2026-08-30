param([string]$RootDir)
$ErrorActionPreference='Stop'
if(-not $RootDir){$RootDir=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path}
$resolved=(Resolve-Path $RootDir).Path
$parent=Split-Path -Parent $resolved
$candidates=@(
  (Join-Path $parent '.myai-cfo-certification-temp'),
  (Join-Path $parent '.certification-temp'),
  (Join-Path $parent '.npm-cache'),
  (Join-Path $parent 'MYAI-CFO-Certification')
)
$empty=Join-Path $env:TEMP ('MYAI-CFO-empty-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $empty | Out-Null
try {
  foreach($target in ($candidates | Select-Object -Unique)) {
    if(Test-Path -LiteralPath $target) {
      try {
        & robocopy.exe $empty $target /MIR /R:0 /W:0 /XJ /NFL /NDL /NJH /NJS | Out-Null
        if($LASTEXITCODE -ge 8){ Write-Warning "Robocopy cleanup returned $LASTEXITCODE for $target" }
      } catch { Write-Warning "Robocopy cleanup failed for $target : $($_.Exception.Message)" }
      try { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop } catch { Write-Warning "Could not remove $target : $($_.Exception.Message)" }
    }
  }
} finally { Remove-Item -LiteralPath $empty -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host 'Stale certification artifact cleanup complete.'
