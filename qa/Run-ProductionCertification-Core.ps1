param(
  [string]$RootDir,
  [string]$JobId = $env:MYAI_CFO_CERT_JOB_ID,
  [string]$ApiBase = $env:MYAI_CFO_CERT_API_BASE
)
$ErrorActionPreference='Stop'
if(-not $RootDir){$RootDir=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path}
if(-not $JobId){$JobId="manual-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"}
$ParentApiBase=$ApiBase
$VisibleApiBase=$ApiBase

function Resolve-Executable {
  param([string[]]$Candidates,[string]$CommandName)
  foreach($c in $Candidates){ if($c -and (Test-Path $c)){ return (Resolve-Path $c).Path } }
  $cmd=Get-Command $CommandName -ErrorAction SilentlyContinue
  if($cmd){ return $cmd.Source }
  return $null
}
$node=Resolve-Executable @((Join-Path $RootDir 'app\tools\node-win\node.exe'),(Join-Path ${env:ProgramFiles} 'nodejs\node.exe'),(Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe')) 'node.exe'
$npm=Resolve-Executable @((Join-Path $RootDir 'app\tools\node-win\npm.cmd'),(Join-Path ${env:ProgramFiles} 'nodejs\npm.cmd'),(Join-Path ${env:ProgramFiles(x86)} 'nodejs\npm.cmd')) 'npm.cmd'
if($node){$nodeDir=Split-Path -Parent $node; if($env:Path -notlike "*$nodeDir*"){ $env:Path="$nodeDir;$env:Path" }}
if(-not $node -or -not $npm){ throw 'Node.js/npm prerequisite not available. Install Node.js 20+ (npm 10+) or include app\tools\node-win in the release package before running production certification.' }
$reportRoot=if($env:MYAI_CFO_CERT_REPORT_ROOT){$env:MYAI_CFO_CERT_REPORT_ROOT}else{Join-Path $RootDir 'app\data\diagnostics\production-certification'}
$jobReportRoot=Join-Path $reportRoot $JobId
$qaReportRoot=if($env:MYAI_CFO_CERT_QA_REPORT_ROOT){$env:MYAI_CFO_CERT_QA_REPORT_ROOT}else{Join-Path $RootDir 'qa\results\production-certification'}
$qaJobReportRoot=Join-Path $qaReportRoot $JobId
New-Item -ItemType Directory -Force -Path $qaJobReportRoot | Out-Null
New-Item -ItemType Directory -Force -Path $jobReportRoot | Out-Null
$consoleLog=Join-Path $jobReportRoot 'certification-console.log'
$certJson=Join-Path $jobReportRoot 'production-certification.json'
$certMarkdown=Join-Path $jobReportRoot 'production-certification.md'
"MYAI CFO production certification $JobId" | Set-Content -Encoding UTF8 $consoleLog
$env:MYAI_CFO_CERT_MAX_TEST_MS='900000'
$env:MYAI_CFO_CERT_MAX_STEP_MS='1200000'
$env:MYAI_CFO_CERT_RETRY_BUDGET='1'
$env:MYAI_CFO_CERT_REQUIRE_FRESH_RESULTS='1'
$env:MYAI_CFO_CERT_STRICT='1'
$env:MYAI_CFO_CERT_CONTINUE_AFTER_STAGE_FAILURE='1'
$env:MYAI_CFO_CERTIFICATION='1'
$env:MYAI_CFO_CERT_ENABLE_HEAVY_EXTRACTORS='0'
# Backend inherits this flag at process launch; late teardown writes fail closed.
$env:MYAI_CFO_CERT_TEARDOWN='1'
$script:PlannedSteps=@(
  @{stepId='CERT-HARNESS';name='Certification harness integrity preflight'},
  @{stepId='CERT-000';name='Windows build prerequisites'},
  @{stepId='CERT-000A';name='Create isolated certification sandbox'},
  @{stepId='CERT-001';name='Generate genuine npm lockfiles'},
  @{stepId='CERT-002';name='Clean backend npm ci'},
  @{stepId='CERT-003';name='Clean frontend npm ci'},
  @{stepId='CERT-004';name='Production Vite build'},
  @{stepId='CERT-004A';name='Certification backend lifecycle start'},
  @{stepId='CERT-0040';name='Visible synthetic CFO evidence seed'},
  @{stepId='CERT-004B';name='Mandatory synthetic CFO evidence provisioning'},
  @{stepId='CERT-004C';name='Synthetic CFO end-to-end surface verification'},
  @{stepId='CERT-004D';name='Comprehensive financial surface certification'},
  @{stepId='CERT-005';name='Static/security/backend assurance'},
  @{stepId='CERT-005A';name='Synthetic CFO financial scenario matrix'},
  @{stepId='CERT-006';name='Live RAG/grounding/citations/agents/models/OmniRoute certification'},
  @{stepId='CERT-007';name='Production browser preview launch'},
  @{stepId='CERT-008A';name='Playwright browser runtime'},
  @{stepId='CERT-008';name='Playwright production E2E'},
  @{stepId='CERT-008B';name='Audit trail forensic verification'},
  @{stepId='CERT-009';name='Release assurance and final gate'}
)

# Machine-neutral certification storage: discover the application root from this
# package/script, then automatically select a writable local volume with enough free space.
function Test-WritableDirectory([string]$Path) {
  try {
    New-Item -ItemType Directory -Force -Path $Path -ErrorAction Stop | Out-Null
    $probe = Join-Path $Path ('.myai-write-test-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [System.IO.File]::WriteAllText($probe,'ok')
    Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
    return $true
  } catch { return $false }
}
function Get-AvailableBytes([string]$Path) {
  try {
    $driveRoot=[System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($Path))
    return ([System.IO.DriveInfo]::new($driveRoot)).AvailableFreeSpace
  } catch { return [int64]0 }
}
function Test-PathRelationship([string]$Parent,[string]$Candidate) {
  try {
    $p=[System.IO.Path]::GetFullPath($Parent).TrimEnd('\\') + '\\'
    $c=[System.IO.Path]::GetFullPath($Candidate).TrimEnd('\\') + '\\'
    return $c.StartsWith($p,[System.StringComparison]::OrdinalIgnoreCase)
  } catch { return $true }
}
function Get-RelativeDepth([string]$Path,[string]$Root) {
  try {
    $full=[System.IO.Path]::GetFullPath($Path)
    $base=[System.IO.Path]::GetFullPath($Root).TrimEnd('\\') + '\\'
    if($full.StartsWith($base,[System.StringComparison]::OrdinalIgnoreCase)) {
      $rel=$full.Substring($base.Length).Trim('\\')
      if([string]::IsNullOrWhiteSpace($rel)){ return 0 }
      return (($rel -split '\\').Count)
    }
    return 0
  } catch { return 999 }
}
function Assert-SafeCertificationWorkspace([string]$AppRoot,[string]$WorkspaceRoot) {
  $app=[System.IO.Path]::GetFullPath((Resolve-Path $AppRoot).Path).TrimEnd('\\')
  $ws=[System.IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd('\\')
  if($ws.Equals($app,[System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Certification workspace cannot equal application root: $ws"
  }
  if(Test-PathRelationship $app $ws) {
    throw "Certification workspace cannot be inside application root: $ws"
  }
  if(Test-PathRelationship $ws $app) {
    # A workspace above the application root is permitted, but it must not be the filesystem root.
    $wsRoot=[System.IO.Path]::GetPathRoot($ws).TrimEnd('\\')
    if($ws.Equals($wsRoot,[System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Certification workspace cannot be the filesystem root: $ws"
    }
  }
  if((Get-RelativeDepth $ws $app) -gt 0) {
    throw "Certification workspace relationship check failed: $ws"
  }
}
function Select-CertificationWorkspaceRoot([string]$AppRoot) {
  $resolved=(Resolve-Path $AppRoot).Path
  $appDrive=[System.IO.Path]::GetPathRoot($resolved)
  $candidates=New-Object System.Collections.Generic.List[string]
  # Prefer a sibling of the application so certification stays local to the installation.
  [void]$candidates.Add((Join-Path (Split-Path -Parent $resolved) '.myai-cfo-certification-temp'))
  # If the install directory is read-only, use the OS temp location.
  if($env:TEMP){[void]$candidates.Add((Join-Path $env:TEMP 'MYAI-CFO-Certification'))}
  # Finally inspect every mounted fixed local drive; no drive letter is assumed.
  foreach($d in [System.IO.DriveInfo]::GetDrives()) {
    if($d.DriveType -eq 'Fixed' -and $d.IsReady){
      [void]$candidates.Add((Join-Path $d.RootDirectory.FullName 'MYAI-CFO-Certification'))
    }
  }
  $ranked=@()
  foreach($candidate in ($candidates | Select-Object -Unique)) {
    $free=Get-AvailableBytes $candidate
    if($free -gt 0 -and (Test-WritableDirectory $candidate)) {
      $drive=[System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($candidate))
      $sameDrive=($drive -eq $appDrive)
      $ranked += [pscustomobject]@{Path=$candidate;Free=$free;SameDrive=$sameDrive}
    }
  }
  $best=$ranked | Sort-Object @{Expression={if($_.SameDrive){0}else{1}}}, @{Expression={$_.Free};Descending=$true} | Select-Object -First 1
  if(-not $best){throw 'Unable to find a writable local volume for certification scratch space.'}
  return $best.Path
}
$certWorkspaceRoot=Select-CertificationWorkspaceRoot $RootDir
# Fresh-run boundary: remove only generated certification outputs from prior runs.
# Never delete application data or normal CFO audit history.
$staleResultNames=@(
  'certification-harness-preflight.json',
  'production-assurance-latest.json',
  'live-certification-latest.json',
  'synthetic-cfo-latest.json',
  'playwright-results.json',
  'audit-forensics-latest.json',
  'production-certification-latest.json'
)
$staleRoots=@(
  (Join-Path $RootDir 'qa\results'),
  (Join-Path $RootDir 'app\data\diagnostics')
)
foreach($base in $staleRoots){
  foreach($name in $staleResultNames){
    $target=Join-Path $base $name
    try{if(Test-Path -LiteralPath $target -PathType Leaf){Remove-Item -LiteralPath $target -Force -ErrorAction Stop}}catch{Write-Host "Stale artifact cleanup warning: $target :: $($_.Exception.Message)"}
  }
}
# Retain only the most recent 5 job reports in the dedicated certification trees.
foreach($jobsRoot in @($reportRoot,$qaReportRoot)){
  try{
    if(Test-Path -LiteralPath $jobsRoot -PathType Container){
      $dirs=Get-ChildItem -LiteralPath $jobsRoot -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
      if($dirs.Count -gt 5){$dirs | Select-Object -Skip 5 | ForEach-Object {Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue}}
    }
  }catch{Write-Host "Old certification report cleanup warning: $jobsRoot :: $($_.Exception.Message)"}
}
Assert-SafeCertificationWorkspace $RootDir $certWorkspaceRoot
$certTempRoot=Join-Path $certWorkspaceRoot ('CERT-'+$JobId)
$certRoot=Join-Path $certTempRoot 'sandbox'
if(Test-Path $certTempRoot){Remove-Item -Recurse -Force $certTempRoot -ErrorAction SilentlyContinue}
New-Item -ItemType Directory -Force -Path $certRoot | Out-Null
$npmCacheRoot=Join-Path $certTempRoot 'npm-cache'
$env:TEMP=Join-Path $certTempRoot 'temp'
$env:TMP=$env:TEMP
$env:NPM_CONFIG_CACHE=$npmCacheRoot
New-Item -ItemType Directory -Force -Path $npmCacheRoot,$env:TEMP | Out-Null
$env:MYAI_CFO_CERT_TEMP_ROOT=$certTempRoot
$BuildRoot=$certRoot

function Write-ConsoleLog { param([string]$Text) Add-Content -Encoding UTF8 -Path $consoleLog -Value $Text }
function Invoke-NativeCapture {
  param([string]$FilePath,[string[]]$Arguments,[string]$WorkingDirectory=$RootDir,[string]$StdoutPath,[string]$StderrPath,[int]$TimeoutMs=0)
  if($TimeoutMs -le 0){ $TimeoutMs=[int]($env:MYAI_CFO_CERT_MAX_STEP_MS) ; if($TimeoutMs -le 0){$TimeoutMs=1800000} }
  $isCmd=$FilePath.ToLower().EndsWith('.cmd') -or $FilePath.ToLower().EndsWith('.bat')
  $psi=New-Object System.Diagnostics.ProcessStartInfo
  if($isCmd){
    # .cmd/.bat files require cmd.exe. Wrap the complete command in an
    # additional quote pair so paths containing spaces are preserved.
    $psi.FileName=$env:ComSpec
    $quotedArgs=(($Arguments|ForEach-Object{
      if($_ -match '[\s"]'){ '"'+($_ -replace '"','\"')+'"' } else { $_ }
    }) -join ' ')
    $psi.Arguments='/d /s /c ""'+$FilePath+'"'+($(if($quotedArgs){' '+$quotedArgs}else{''}))+'"'
  } else {
    $psi.FileName=$FilePath
    $psi.Arguments=(($Arguments|ForEach-Object{if($_ -match '[\s"]'){ '"'+($_ -replace '"','\"')+'"'}else{$_}})-join ' ')
  }
  $psi.WorkingDirectory=$WorkingDirectory;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true
  $proc=New-Object System.Diagnostics.Process;$proc.StartInfo=$psi
  if(-not $proc.Start()){throw "Failed to start native command $FilePath"}
  $outTask=$proc.StandardOutput.ReadToEndAsync();$errTask=$proc.StandardError.ReadToEndAsync();
  $completed=$proc.WaitForExit($TimeoutMs)
  if(-not $completed){
    try{ if($env:OS -eq 'Windows_NT'){ Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c',"taskkill /PID $($proc.Id) /T /F") -WindowStyle Hidden -Wait | Out-Null } else { $proc.Kill() } }catch{}
    try{$proc.WaitForExit(10000)|Out-Null}catch{}
    $stdout=$outTask.Result; $stderr=$errTask.Result
    if($StdoutPath){$stdout|Set-Content -Encoding UTF8 $StdoutPath}; if($StderrPath){$stderr|Set-Content -Encoding UTF8 $StderrPath}
    throw "Native command timed out after $TimeoutMs ms: $FilePath"
  }
  $stdout=$outTask.Result;$stderr=$errTask.Result
  if($StdoutPath){$stdout|Set-Content -Encoding UTF8 $StdoutPath};if($StderrPath){$stderr|Set-Content -Encoding UTF8 $StderrPath}
  return [pscustomobject]@{ExitCode=$proc.ExitCode;Stdout=$stdout;Stderr=$stderr}
}
function Write-CertMarkdown {
  param([string]$Overall='RUNNING',[string]$Reason='')
  $lines=@('# MYAI CFO - Production Certification',"","- **Application:** $((Get-Content (Join-Path $RootDir 'VERSION.txt') -Raw).Trim())","- **Job ID:** $JobId","- **Generated:** $([DateTime]::UtcNow.ToString('o'))","- **Status:** $Overall","- **Reason:** $Reason","- **Source:** $RootDir","- **Sandbox:** $certRoot","",'## Steps','')
  foreach($step in $script:CertSteps){ $lines += "- **$($step.stepId)** - $($step.name): **$($step.status)** - $($step.reason) - $($step.durationMs) ms" }
  $lines += @('', '## Files',"- JSON: $certJson","- Console log: $consoleLog","- Sandbox-copy log: $(Join-Path $jobReportRoot 'sandbox-copy.log')")
  $lines | Set-Content -Encoding UTF8 $certMarkdown
  $lines | Set-Content -Encoding UTF8 (Join-Path $qaJobReportRoot 'production-certification.md')
}

function Save-StepEvidence { param([hashtable]$Step) $file=Join-Path $jobReportRoot ("step-{0}.json" -f $Step.stepId); $Step | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 $file
  Copy-Item -Force $file (Join-Path $qaJobReportRoot (Split-Path $file -Leaf)) -ErrorAction SilentlyContinue }

function Send-Step {
  param([string]$StepId,[string]$Name,[ValidateSet('START','PASS','FAIL')][string]$Status,[string]$Reason='',[int]$DurationMs=0,[object]$Evidence=$null,[int]$ExitCode=0)
  try {
    $targetBase = if($script:certApiBase){$script:certApiBase}elseif($ParentApiBase){$ParentApiBase}else{$null}
    if(-not $targetBase){ return }
    $body=@{jobId=$JobId;stepId=$StepId;name=$Name;status=$Status;reason=$Reason;durationMs=$DurationMs;exitCode=$ExitCode;evidence=$Evidence} | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method Post -Uri "$targetBase/api/audit/certification-event" -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
  } catch {}
}

$script:CertSteps=@()
if(-not $ParentApiBase){ throw 'Certification parent application API base is required; refusing to fall back to a hard-coded port.' }
$script:certBackend=$null
$script:certApiPort=$null
$script:certApiBase=$null
function Get-FreeLoopbackPort {
  $listener=[System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
  try {$listener.Start(); return ([int]$listener.LocalEndpoint.Port)} finally {try{$listener.Stop()}catch{}}
}
function Wait-ApiReady([string]$Base,[int]$TimeoutSec=60){
  $deadline=(Get-Date).AddSeconds($TimeoutSec)
  while((Get-Date)-lt $deadline){
    if($script:certBackend -and $script:certBackend.HasExited){throw "Certification backend exited before readiness: exit=$($script:certBackend.ExitCode)"}
    try{$r=Invoke-WebRequest -UseBasicParsing -Uri "$Base/api/health" -TimeoutSec 3; if($r.StatusCode -eq 200){return $true}}catch{}
    Start-Sleep -Milliseconds 500
  }
  throw "Certification backend did not become healthy within ${TimeoutSec}s at $Base"
}
function Start-CertBackend {
  # Let the OS allocate the certification port; the server writes the bound port to a file.
  $portFile=Join-Path $jobReportRoot 'certification-backend.port'
  $log=Join-Path $jobReportRoot 'certification-backend.stdout.log'; $err=Join-Path $jobReportRoot 'certification-backend.stderr.log'
  $env:MYAI_CFO_API_PORT='0'
  $env:MYAI_CFO_CERT_PORT_FILE=[string]$portFile
  $env:MYAI_CFO_QA_MODE='1'
  New-Item -ItemType File -Force -Path $log,$err | Out-Null
  $args=@((Join-Path $BuildRoot 'app\backend\server.mjs'),'--production-certification')
  $script:certBackend=Start-Process -FilePath $node -ArgumentList $args -WorkingDirectory $BuildRoot -RedirectStandardOutput $log -RedirectStandardError $err -PassThru -WindowStyle Hidden
  $deadline=(Get-Date).AddSeconds(90)
  while((Get-Date)-lt $deadline){
    if($script:certBackend.HasExited){$tail=(Get-Content $err -Raw -ErrorAction SilentlyContinue);throw "Certification backend exited before readiness: exit=$($script:certBackend.ExitCode). stderr=$tail"}
    if(Test-Path -LiteralPath $portFile){
      try{
        $portText=(Get-Content $portFile -Raw).Trim(); $parsed=0
        if([int]::TryParse($portText,[ref]$parsed) -and $parsed -gt 0 -and $parsed -lt 65536){
          $script:certApiPort=$parsed; $script:certApiBase="http://127.0.0.1:$script:certApiPort"
          try{$r=Invoke-WebRequest -UseBasicParsing -Uri "$script:certApiBase/api/health" -TimeoutSec 3;if($r.StatusCode -eq 200){return @{base=$script:certApiBase;port=$script:certApiPort;pid=$script:certBackend.Id;stdout=$log;stderr=$err;portFile=$portFile}}}catch{}
        }
      }catch{}
    }
    Start-Sleep -Milliseconds 250
  }
  $tail=(Get-Content $err -Raw -ErrorAction SilentlyContinue); $out=(Get-Content $log -Raw -ErrorAction SilentlyContinue); throw "Certification backend readiness timeout. portFile=$portFile. stdout=$out stderr=$tail"
}
function Stop-ProcessTree([System.Diagnostics.Process]$Process) {
  if(-not $Process){return}
  try {
    if(-not $Process.HasExited){
      if($env:OS -eq 'Windows_NT'){
        $tk=Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c',"taskkill /PID $($Process.Id) /T /F") -WindowStyle Hidden -Wait -PassThru
        if($tk.ExitCode -ne 0){try{$Process.Kill()}catch{}}
      } else {
        try{$Process.Kill()}catch{}
      }
    }
  } catch { try{$Process.Kill()}catch{} }
  try{$Process.WaitForExit(10000)|Out-Null}catch{}
}
function Stop-CertBackend {
  if($script:certBackend){Stop-ProcessTree $script:certBackend;try{$script:certBackend.Dispose()}catch{};$script:certBackend=$null}
  $script:certApiPort=$null; $script:certApiBase=$null
  Remove-Item Env:MYAI_CFO_API_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:MYAI_CFO_CERT_PORT_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:MYAI_CFO_QA_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:MYAI_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MYAI_CFO_CERT_JOB_ID -ErrorAction SilentlyContinue
  Remove-Item Env:MYAI_CFO_VISIBLE_API_BASE -ErrorAction SilentlyContinue
  Remove-Item Env:MYAI_CFO_VISIBLE_CERTIFICATION -ErrorAction SilentlyContinue
  Remove-Item Env:MYAI_CFO_CERT_REPORT_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:MYAI_CFO_CERT_QA_REPORT_ROOT -ErrorAction SilentlyContinue
}
function Save-CertState {
  param([string]$Overall='RUNNING',[string]$Reason='')
  $doc=@{schemaVersion='3.0';reportType='MYAI_CFO_PRODUCTION_CERTIFICATION';applicationVersion=(Get-Content (Join-Path $RootDir 'VERSION.txt') -Raw).Trim();build=(Get-Content (Join-Path $RootDir 'VERSION.txt') -Raw).Trim();jobId=$JobId;generatedAt=[DateTime]::UtcNow.ToString('o');status=$Overall;reason=$Reason;sourceRoot=$RootDir;sandboxRoot=$certRoot;steps=$script:CertSteps;reportDirectory=$jobReportRoot;consoleLog=$consoleLog}
  New-Item -ItemType Directory -Force -Path (Join-Path $RootDir 'qa\results') | Out-Null
  $jsonText=$doc | ConvertTo-Json -Depth 30
  $jsonText | Set-Content -Encoding UTF8 $certJson
  $jsonText | Set-Content -Encoding UTF8 (Join-Path $qaJobReportRoot 'production-certification.json')
  $jsonText | Set-Content -Encoding UTF8 (Join-Path $RootDir 'qa\results\production-certification-latest.json')
  $jsonText | Set-Content -Encoding UTF8 (Join-Path $reportRoot 'production-certification-latest.json')
  Write-CertMarkdown $Overall $Reason
}
function Collect-CertArtifacts {
  try {
    $artifactDir=Join-Path $jobReportRoot 'artifacts'
    New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
    if(Test-Path (Join-Path $BuildRoot 'qa\results')){ Copy-Item -Recurse -Force (Join-Path $BuildRoot 'qa\results\*') $artifactDir -ErrorAction SilentlyContinue }
    if(Test-Path (Join-Path $BuildRoot 'app\frontend\dist')){ Copy-Item -Recurse -Force (Join-Path $BuildRoot 'app\frontend\dist') (Join-Path $artifactDir 'frontend-dist') -ErrorAction SilentlyContinue }
    if(Test-Path (Join-Path $BuildRoot 'app\frontend\package-lock.json')){ Copy-Item -Force (Join-Path $BuildRoot 'app\frontend\package-lock.json') $artifactDir -ErrorAction SilentlyContinue }
    if(Test-Path (Join-Path $BuildRoot 'app\backend\package-lock.json')){ Copy-Item -Force (Join-Path $BuildRoot 'app\backend\package-lock.json') $artifactDir -ErrorAction SilentlyContinue }
  } catch { Write-ConsoleLog "Artifact collection warning: $($_.Exception.Message)" }
}

function Run-Step {
  param([string]$StepId,[string]$Name,[scriptblock]$Action,[switch]$Fatal)
  $sw=[Diagnostics.Stopwatch]::StartNew(); Send-Step $StepId $Name START; Write-ConsoleLog "START $StepId $Name"
  $actionOutput=@()
  try {
    $actionOutput=@(& $Action 2>&1)
    $sw.Stop()
    $evidenceText=($actionOutput | Out-String -Width 400).Trim()
    if($evidenceText){Add-Content -Encoding UTF8 -Path $consoleLog -Value $evidenceText}
    if($evidenceText.Length -gt 12000){$evidenceText=$evidenceText.Substring(0,12000)+'`n[TRUNCATED]'}
    $step=@{stepId=$StepId;name=$Name;status='PASS';reason='';durationMs=$sw.ElapsedMilliseconds;evidence=$evidenceText}
    $script:CertSteps += $step
    Save-StepEvidence $step
    Save-CertState 'RUNNING'
    Send-Step $StepId $Name PASS '' $sw.ElapsedMilliseconds $step 0
    return $true
  } catch {
    $sw.Stop(); $reason=$_.Exception.Message
    $evidenceText=($actionOutput | Out-String -Width 400).Trim()
    if($evidenceText){Add-Content -Encoding UTF8 -Path $consoleLog -Value $evidenceText}
    if($evidenceText.Length -gt 12000){$evidenceText=$evidenceText.Substring(0,12000)+'`n[TRUNCATED]'}
    $continueMode=($env:MYAI_CFO_CERT_CONTINUE_AFTER_STAGE_FAILURE -eq '1')
    $continueEligible=($StepId -eq 'CERT-0040' -or $script:CertSteps.Count -gt 8)
    $step=@{stepId=$StepId;name=$Name;status='FAIL';reason=$reason;durationMs=$sw.ElapsedMilliseconds;evidence=$evidenceText;continuedAfterFailure=([bool]($continueMode -and $continueEligible -and -not $Fatal))}
    $script:CertSteps += $step
    Save-StepEvidence $step
    Write-ConsoleLog "FAIL $StepId $Name :: $reason"
    Send-Step $StepId $Name FAIL $reason $sw.ElapsedMilliseconds $step 1
    if($Fatal -or -not ($continueMode -and $continueEligible)){ Save-CertState 'HOLD' $reason; throw }
    Save-CertState 'RUNNING' "Continuing after non-fatal stage failure at $StepId."
    return $false
  }
}

function Write-SkippedSteps {
  param([string]$BlockedBy,[string]$Reason)
  $existing=@($script:CertSteps | ForEach-Object { $_.stepId })
  foreach($planned in $script:PlannedSteps){
    if($existing -contains $planned.stepId){continue}
    $step=@{stepId=$planned.stepId;name=$planned.name;status='NOT_RUN';reason=$Reason;evidence=@{blockedBy=$BlockedBy;classification='blocked-by-prior-failure'}}
    $script:CertSteps += $step
    Save-StepEvidence $step
  }
}

Write-Host '=== MYAI CFO FULL PRODUCTION CERTIFICATION ===' -ForegroundColor Cyan
# Fresh-run boundary: clear only generated certification outputs from both source and isolated trees.
foreach($base in @((Join-Path $RootDir 'qa\results'),(Join-Path $BuildRoot 'qa\results'))){
  foreach($name in $staleResultNames){
    $target=Join-Path $base $name
    try{if(Test-Path -LiteralPath $target -PathType Leaf){Remove-Item -LiteralPath $target -Force -ErrorAction Stop}}catch{Write-ConsoleLog "Fresh-boundary cleanup warning: $target :: $($_.Exception.Message)"}
  }
}

$script:FinalExitCode=2
$preview=$null
$visiblePreview=$null
$visiblePreviewPort=$null
$certificationSucceeded=$false
try {
  Wait-ApiReady $ParentApiBase 30 | Out-Null
  Run-Step 'CERT-HARNESS' 'Certification harness integrity preflight' {
    $r=Invoke-NativeCapture $node @((Join-Path $RootDir 'qa\Preflight-ProductionCertification.mjs'),$RootDir) $RootDir (Join-Path $jobReportRoot 'harness-preflight.stdout.log') (Join-Path $jobReportRoot 'harness-preflight.stderr.log')
    if($r.ExitCode -ne 0){throw "Certification harness preflight failed with exit code $($r.ExitCode)."}
    $reportPath=Join-Path $RootDir 'qa\results\certification-harness-preflight.json'
    if(-not(Test-Path $reportPath)){throw 'Harness preflight report was not produced.'}
    return @{exitCode=$r.ExitCode;report=$reportPath;stdout=$r.Stdout;stderr=$r.Stderr}
  }

  Run-Step 'CERT-000' 'Windows build prerequisites' {
    $nodeVer=Invoke-NativeCapture $node @('--version') $RootDir (Join-Path $jobReportRoot 'node-version.stdout.log') (Join-Path $jobReportRoot 'node-version.stderr.log')
    $npmVer=Invoke-NativeCapture $npm @('--version') $RootDir (Join-Path $jobReportRoot 'npm-version.stdout.log') (Join-Path $jobReportRoot 'npm-version.stderr.log')
    if($nodeVer.ExitCode -ne 0 -or $npmVer.ExitCode -ne 0){
      $parts=@(); if($nodeVer.ExitCode -ne 0){$parts += "node.exe exit=$($nodeVer.ExitCode): $($nodeVer.Stderr.Trim())"}; if($npmVer.ExitCode -ne 0){$parts += "npm.cmd exit=$($npmVer.ExitCode): $($npmVer.Stderr.Trim())"}; throw ('Node/npm version probe failed. ' + ($parts -join ' | '))
    }
    if($nodeVer.Stdout.Trim() -notmatch '^v(2[0-9]|[3-9][0-9])\.') {throw "Node.js 20+ required; detected $($nodeVer.Stdout.Trim())"}
    if($npmVer.Stdout.Trim() -notmatch '^(1[0-9]|[2-9][0-9])\.') {throw "npm 10+ required; detected $($npmVer.Stdout.Trim())"}
    $ping=Invoke-NativeCapture $npm @('ping','--registry','https://registry.npmjs.org','--fetch-timeout=10000','--fetch-retries=0') $RootDir (Join-Path $jobReportRoot 'npm-ping.stdout.log') (Join-Path $jobReportRoot 'npm-ping.stderr.log')
    if($ping.ExitCode -ne 0){$msg=$ping.Stderr.Trim();if(-not $msg){$msg='npm registry probe failed with exit code '+$ping.ExitCode};throw $msg}
    return @{node=$nodeVer.Stdout.Trim();npm=$npmVer.Stdout.Trim();npmPingExit=$ping.ExitCode}
  }

  Run-Step 'CERT-000A' 'Create isolated certification sandbox' {
    $copyLog=Join-Path $jobReportRoot 'sandbox-copy.log'
    $copyArgs=@($RootDir,$certRoot,'/E','/COPY:DAT','/DCOPY:DAT','/XJ','/R:2','/W:1','/NFL','/NDL','/NJH','/NJS',"/LOG+:$copyLog",'/XD',
      "$RootDir\app\backend\node_modules","$RootDir\app\frontend\node_modules","$RootDir\qa\results","$RootDir\app\data\documents","$RootDir\app\data\knowledge\uploads","$RootDir\app\data\models","$RootDir\app\data\diagnostics","$RootDir\app\data\audit","$RootDir\app\.myai-cfo\audit","$RootDir\.certification-temp","$RootDir\.npm-cache","$RootDir\.myai-cfo-certification-temp")
    $r=Invoke-NativeCapture 'robocopy.exe' $copyArgs $RootDir (Join-Path $jobReportRoot 'robocopy.stdout.log') (Join-Path $jobReportRoot 'robocopy.stderr.log')
    "Robocopy exit code: $($r.ExitCode)"|Add-Content -Encoding UTF8 $copyLog
    if($r.ExitCode -ge 8){throw "Certification sandbox copy failed with robocopy exit code $($r.ExitCode). See $copyLog"}
    if(Test-Path (Join-Path $certRoot 'app\frontend\node_modules')){throw 'Certification sandbox is contaminated with frontend node_modules.'}
    if(Test-Path (Join-Path $certRoot 'app\backend\node_modules')){throw 'Certification sandbox is contaminated with backend node_modules.'}
    return @{robocopyExit=$r.ExitCode;copyLog=$copyLog}
  }

  Run-Step 'CERT-001' 'Generate genuine npm lockfiles' {
    $ps=Get-Command powershell.exe -ErrorAction SilentlyContinue|Select-Object -ExpandProperty Source; if(-not $ps){throw 'PowerShell is required for lockfile generation.'}; $r=Invoke-NativeCapture $ps @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $RootDir 'scripts\setup\ensure-lockfiles.ps1'),'-RootDir',$BuildRoot) $BuildRoot (Join-Path $jobReportRoot 'lockfiles.stdout.log') (Join-Path $jobReportRoot 'lockfiles.stderr.log'); if($r.ExitCode -ne 0){throw "Lockfile generation failed with exit code $($r.ExitCode)."}
  }
  Run-Step 'CERT-002' 'Clean backend npm ci' { Push-Location (Join-Path $BuildRoot 'app\backend'); try { $r=Invoke-NativeCapture $npm @('ci','--ignore-scripts','--no-audit','--no-fund') (Join-Path $BuildRoot 'app\backend') (Join-Path $jobReportRoot 'backend-npm-ci.stdout.log') (Join-Path $jobReportRoot 'backend-npm-ci.stderr.log'); if($r.ExitCode -ne 0){throw "Backend npm ci failed with exit code $($r.ExitCode)."} } finally { Pop-Location } }
  Run-Step 'CERT-003' 'Clean frontend npm ci' { Push-Location (Join-Path $BuildRoot 'app\frontend'); try { $r=Invoke-NativeCapture $npm @('ci','--ignore-scripts','--no-audit','--no-fund') (Join-Path $BuildRoot 'app\frontend') (Join-Path $jobReportRoot 'frontend-npm-ci.stdout.log') (Join-Path $jobReportRoot 'frontend-npm-ci.stderr.log'); if($r.ExitCode -ne 0){throw "Frontend npm ci failed with exit code $($r.ExitCode)."} } finally { Pop-Location } }
  Run-Step 'CERT-004' 'Production Vite build' {
    $cssFiles=Get-ChildItem -Path (Join-Path $BuildRoot 'app\frontend\src') -Filter '*.css' -File -Recurse -ErrorAction SilentlyContinue; $cssViolations=@(); foreach($cssFile in $cssFiles){$cssText=Get-Content -Raw -Encoding UTF8 $cssFile.FullName;if($cssText -match '\\n\\n/\\*' -or $cssText -match '\*/\\n\\.' -or $cssText -match '\\n\\.[A-Za-z_-]'){$cssViolations += $cssFile.FullName}}; if($cssViolations.Count -gt 0){throw ("Frontend CSS source contains literal escaped newline sequences that can break Lightning CSS minification: " + ($cssViolations -join '; '))}
    Push-Location (Join-Path $BuildRoot 'app\frontend'); try {$r=Invoke-NativeCapture $npm @('run','build') (Join-Path $BuildRoot 'app\frontend') (Join-Path $jobReportRoot 'vite-build.stdout.log') (Join-Path $jobReportRoot 'vite-build.stderr.log'); if($r.ExitCode -ne 0){throw "Production Vite build failed with exit code $($r.ExitCode)."}; if(-not(Test-Path (Join-Path $BuildRoot 'app\frontend\dist\index.html'))){throw 'Production Vite build completed without dist/index.html.'} } finally { Pop-Location }
  }

  Run-Step 'CERT-004A' 'Certification backend lifecycle start' {
    $started=Start-CertBackend; $script:certApiBase=$started.base; $script:certApiPort=$started.port; $ApiBase=$script:certApiBase; $env:MYAI_BASE_URL=$script:certApiBase; $env:MYAI_CFO_API_PORT=[string]$script:certApiPort; $env:MYAI_CFO_CERT_JOB_ID=$JobId; $env:MYAI_CFO_VISIBLE_API_BASE=if($env:MYAI_CFO_VISIBLE_API_BASE){$env:MYAI_CFO_VISIBLE_API_BASE}else{$VisibleApiBase}; $env:MYAI_CFO_VISIBLE_CERTIFICATION='1';
    $versionProbe=Invoke-RestMethod -Method Get -Uri "$script:certApiBase/api/health" -TimeoutSec 15; if(-not $versionProbe){throw 'Certification backend health probe returned an empty response.'}
    $context=[ordered]@{jobId=$JobId;certificationApiBase=$script:certApiBase;certificationApiPort=$script:certApiPort;visibleApiBase=$VisibleApiBase;parentApiBase=$ParentApiBase;backendPid=$started.pid;createdAt=[DateTime]::UtcNow.ToString('o')};
    New-Item -ItemType Directory -Force -Path (Join-Path $BuildRoot 'qa\results') | Out-Null;
    $contextJson=$context|ConvertTo-Json -Depth 10; $contextJson|Set-Content -Encoding UTF8 (Join-Path $jobReportRoot 'certification-context.json'); $contextJson|Set-Content -Encoding UTF8 (Join-Path $BuildRoot 'qa\results\certification-context.json');
    if(-not(Test-Path (Join-Path $BuildRoot 'qa\results\certification-context.json'))){throw 'Certification context file was not persisted into the isolated sandbox.'}
    $d=Invoke-RestMethod -Method Get -Uri "$script:certApiBase/api/disclaimer" -TimeoutSec 15; $a=Invoke-RestMethod -Method Post -Uri "$script:certApiBase/api/disclaimer/accept" -ContentType 'application/json' -Body ((@{version=$d.version;hash=$d.hash}|ConvertTo-Json -Compress)) -TimeoutSec 15; if(-not $a.accepted){throw 'Certification backend did not accept the required disclaimer.'}; return @{base=$script:certApiBase;port=$script:certApiPort;pid=$started.pid;stdout=$started.stdout;stderr=$started.stderr;disclaimerAccepted=$true}
  }

  Run-Step 'CERT-0040' 'Visible synthetic CFO evidence seed' {
    if(-not $ParentApiBase){throw 'Visible application API base is required for the early synthetic seed.'}
    # The visible application is already running before certification. Require the real user disclaimer to be accepted; do not bypass consent.
    $disc=Invoke-RestMethod -Method Get -Uri "$ParentApiBase/api/disclaimer" -TimeoutSec 15
    if(-not $disc.accepted){throw 'Visible application disclaimer has not been accepted. Accept the disclaimer before running production certification.'}
    $env:MYAI_CFO_VISIBLE_CERTIFICATION='1'; $env:MYAI_CFO_CERT_JOB_ID=$JobId; $env:MYAI_CFO_VISIBLE_API_BASE=$ParentApiBase; $env:MYAI_BASE_URL=$ParentApiBase
    # The visible seed performs heavy document-AI work. Serialize it against the local model runtime too,
    # otherwise extraction competes with the interactive application for the same CPU/GPU/model.
    $visibleRuntime=$null; $visibleRuntimeWasLoaded=$false; try { $visibleRuntime=Invoke-RestMethod -Method Get -Uri "$ParentApiBase/api/models/runtime" -TimeoutSec 15; $visibleRuntimeWasLoaded=[bool]$visibleRuntime.live } catch {}
    if($visibleRuntimeWasLoaded){ Invoke-RestMethod -Method Post -Uri "$ParentApiBase/api/models/runtime/unload" -ContentType 'application/json' -Body '{}' -TimeoutSec 30 | Out-Null; Start-Sleep -Seconds 2 }
    try {
      $seedArgs=@((Join-Path $BuildRoot 'qa\tests\provision-synthetic-evidence.mjs'),'--apiBase',$ParentApiBase,'--visibleApiBase',$ParentApiBase,'--jobId',$JobId,'--visibleOnly','--seedOnly')
      $r=Invoke-NativeCapture $node $seedArgs $BuildRoot (Join-Path $jobReportRoot 'synthetic-seed.stdout.log') (Join-Path $jobReportRoot 'synthetic-seed.stderr.log')
      if($r.ExitCode -ne 0){throw "Early visible synthetic evidence seed failed with exit code $($r.ExitCode): $($r.Stderr.Trim())"}
    } finally {
      if($visibleRuntimeWasLoaded -and $visibleRuntime.live.filename){ try { Invoke-RestMethod -Method Post -Uri "$ParentApiBase/api/models/runtime/load" -ContentType 'application/json' -Body (@{filename=$visibleRuntime.live.filename}|ConvertTo-Json -Compress) -TimeoutSec 120 | Out-Null } catch { Add-Content -Encoding UTF8 -Path (Join-Path $jobReportRoot 'synthetic-seed.stderr.log') -Value ("Visible runtime restore warning: "+$_.Exception.Message) } }
    }
    $outPath=Join-Path $BuildRoot 'qa\results\synthetic-evidence-latest.json'; if(-not(Test-Path $outPath)){throw 'Early synthetic seed did not produce synthetic-evidence-latest.json.'}
    $seed=Get-Content $outPath -Raw|ConvertFrom-Json; if($seed.status -ne 'PASS'){throw "Early synthetic seed reported $($seed.status): $($seed.errors -join '; ')"}; if([int]$seed.companyCount -ne 4){throw "Early synthetic seed created $($seed.companyCount) companies; expected 4."}; if([int]$seed.totalFinancialStatements -lt 12){throw "Early synthetic seed created $($seed.totalFinancialStatements) financial documents; expected at least 12."}; if(-not $seed.knowledgePdf -or -not $seed.knowledgeUrl){throw 'Early synthetic seed did not create both Knowledge Hub PDF and URL.'}
    return @{visibleApiBase=$ParentApiBase;companyCount=[int]$seed.companyCount;financialStatementCount=[int]$seed.totalFinancialStatements;knowledgePdf=[bool]$seed.knowledgePdf;knowledgeUrl=[bool]$seed.knowledgeUrl;result=$outPath;disclaimerAccepted=$true}
  }

  Run-Step 'CERT-004B' 'Mandatory synthetic CFO evidence provisioning' {
    $env:MYAI_BASE_URL=$script:certApiBase; $env:MYAI_CFO_API_PORT=[string]$script:certApiPort; $env:MYAI_CFO_CERT_JOB_ID=$JobId; $env:MYAI_CFO_VISIBLE_CERTIFICATION='1'; $env:MYAI_CFO_VISIBLE_API_BASE=if($env:MYAI_CFO_VISIBLE_API_BASE){$env:MYAI_CFO_VISIBLE_API_BASE}else{$VisibleApiBase}
    if(-not $script:certApiBase){throw 'CERT-004B has no certification backend base URL.'}; if(-not $VisibleApiBase){throw 'CERT-004B has no visible application base URL.'}; if($VisibleApiBase -eq $script:certApiBase){throw 'CERT-004B certification and visible application API bases must be distinct.'}
    # Serialize physical local-model usage: pause visible runtime during isolated provisioning.
    $visibleRuntime=$null; $visibleRuntimeWasLoaded=$false;
    try { $visibleRuntime=Invoke-RestMethod -Method Get -Uri "$VisibleApiBase/api/models/runtime" -TimeoutSec 15; $visibleRuntimeWasLoaded=[bool]$visibleRuntime.live } catch {}
    if($visibleRuntimeWasLoaded){ Invoke-RestMethod -Method Post -Uri "$VisibleApiBase/api/models/runtime/unload" -ContentType 'application/json' -Body '{}' -TimeoutSec 30 | Out-Null; Start-Sleep -Seconds 2 }
    try {
      $syntheticArgs=@((Join-Path $BuildRoot 'qa\tests\provision-synthetic-evidence.mjs'),'--apiBase',$script:certApiBase,'--visibleApiBase',$VisibleApiBase,'--jobId',$JobId)
      $r=Invoke-NativeCapture $node $syntheticArgs $BuildRoot (Join-Path $jobReportRoot 'synthetic-evidence.stdout.log') (Join-Path $jobReportRoot 'synthetic-evidence.stderr.log'); if($r.ExitCode -ne 0){throw "Mandatory synthetic evidence provisioning failed with exit code $($r.ExitCode)."}
    } finally {
      if($visibleRuntimeWasLoaded -and $visibleRuntime.live.filename){ try { Invoke-RestMethod -Method Post -Uri "$VisibleApiBase/api/models/runtime/load" -ContentType 'application/json' -Body (@{filename=$visibleRuntime.live.filename}|ConvertTo-Json -Compress) -TimeoutSec 120 | Out-Null } catch { Add-Content -Encoding UTF8 -Path (Join-Path $jobReportRoot 'synthetic-evidence.stderr.log') -Value ("Visible runtime restore warning: "+$_.Exception.Message) } }
    }
    $outPath=Join-Path $BuildRoot 'qa\results\synthetic-evidence-latest.json'; if(-not(Test-Path $outPath)){throw 'Synthetic evidence result report was not produced.'}; $evidence=Get-Content -Raw -Encoding UTF8 $outPath | ConvertFrom-Json
    if($evidence.status -ne 'PASS'){throw 'Synthetic evidence result did not report PASS.'}; if([int]$evidence.companyCount -lt 4){throw 'Synthetic evidence did not provision the required four companies, including the production-only Comprehensive company.'}; if([int]$evidence.totalFinancialStatements -lt 12){throw 'Synthetic evidence did not provision the required twelve financial-statement documents, including the three-year Comprehensive statements.'}; if(-not [bool]$evidence.knowledgePdf -or -not [bool]$evidence.knowledgeUrl){throw 'Synthetic evidence did not provision both Knowledge Hub PDF and URL.'}
    $visibleTarget=@($evidence.targets | Where-Object {$_.label -eq 'VISIBLE_APPLICATION'} | Select-Object -First 1); if(-not $visibleTarget){throw 'Visible application synthetic evidence target was not recorded.'}; if([int]($visibleTarget.verification.companies.Count) -lt 4){throw 'Visible application does not contain all four synthetic companies, including Comprehensive.'}; if([int]$visibleTarget.verification.activeDocumentCount -lt 12){throw 'Visible application does not contain all twelve required synthetic financial statements.'}; if(-not [bool]$visibleTarget.verification.hasKnowledgePdf -or -not [bool]$visibleTarget.verification.hasKnowledgeUrl){throw 'Visible application does not contain both required Knowledge Hub entries.'}
    return @{exitCode=$r.ExitCode;report=$outPath;companyCount=$evidence.companyCount;financialStatements=$evidence.totalFinancialStatements;knowledgePdf=$evidence.knowledgePdf;knowledgeUrl=$evidence.knowledgeUrl;visibleVerified=$true}
  }

  Run-Step 'CERT-004C' 'Synthetic CFO end-to-end surface verification' {
    $env:MYAI_BASE_URL=$script:certApiBase; $env:MYAI_CFO_API_PORT=[string]$script:certApiPort; $env:MYAI_CFO_CERT_JOB_ID=$JobId
    $r=Invoke-NativeCapture $node @((Join-Path $BuildRoot 'qa\tests\synthetic-cfo-e2e.mjs'),'--apiBase',$script:certApiBase,'--visibleApiBase',$VisibleApiBase,'--jobId',$JobId) $BuildRoot (Join-Path $jobReportRoot 'synthetic-cfo-e2e.stdout.log') (Join-Path $jobReportRoot 'synthetic-cfo-e2e.stderr.log'); if($r.ExitCode -ne 0){throw "Synthetic CFO end-to-end verification failed with exit code $($r.ExitCode)."}; if(-not(Test-Path (Join-Path $BuildRoot 'qa\results\synthetic-cfo-e2e-latest.json'))){throw 'Synthetic CFO end-to-end result report was not produced.'}
    # API verification is insufficient because the reported defect was that the user-facing application stayed empty.
    # Render the actual visible application against the visible API and verify Companies, Documents, Dashboard, Intelligence and Knowledge Hub.
    $pw=Invoke-NativeCapture $npm @('exec','--yes','--','playwright','install','chromium') $BuildRoot (Join-Path $jobReportRoot 'visible-playwright-install.stdout.log') (Join-Path $jobReportRoot 'visible-playwright-install.stderr.log'); if($pw.ExitCode -ne 0){throw "Visible Playwright Chromium installation failed with exit code $($pw.ExitCode)."}
    $visiblePreviewPort=Get-FreeLoopbackPort; $visibleApiQuery=[uri]::EscapeDataString($VisibleApiBase)
    $env:MYAI_CFO_VISIBLE_UI_BASE="http://127.0.0.1:$visiblePreviewPort/?apiBase=$visibleApiQuery"; $env:MYAI_CFO_UI_BASE=$env:MYAI_CFO_VISIBLE_UI_BASE; $env:MYAI_CFO_UI_URL=$env:MYAI_CFO_VISIBLE_UI_BASE; $env:MYAI_VISIBLE_EVIDENCE_DIR=$jobReportRoot
    $vlog=Join-Path $jobReportRoot 'visible-vite-preview.stdout.log'; $verr=Join-Path $jobReportRoot 'visible-vite-preview.stderr.log'; $vargs='/d /s /c ""'+$npm+'" run preview -- --host 127.0.0.1 --port '+$visiblePreviewPort+'"'; $visiblePreview=Start-Process -FilePath $env:ComSpec -ArgumentList $vargs -WorkingDirectory (Join-Path $BuildRoot 'app\frontend') -RedirectStandardOutput $vlog -RedirectStandardError $verr -PassThru -WindowStyle Hidden
    $ready=$false; for($i=0;$i -lt 60;$i++){if($visiblePreview.HasExited){throw "Visible Vite preview exited before readiness: exit=$($visiblePreview.ExitCode)"}; try{$vr=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$visiblePreviewPort/" -TimeoutSec 2;if($vr.StatusCode -eq 200){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 500}; if(-not $ready){throw 'Visible Vite preview did not become reachable.'}
    $vrun=Invoke-NativeCapture $npm @('exec','--yes','--','playwright','test','qa/browser/visible-cfo-evidence.spec.mjs','--reporter=line') $BuildRoot (Join-Path $jobReportRoot 'visible-playwright.stdout.log') (Join-Path $jobReportRoot 'visible-playwright.stderr.log'); if($vrun.ExitCode -ne 0){throw "Visible CFO browser evidence verification failed with exit code $($vrun.ExitCode)."}
    try{if($visiblePreview -and -not $visiblePreview.HasExited){if($env:OS -eq 'Windows_NT'){Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c',"taskkill /PID $($visiblePreview.Id) /T /F") -WindowStyle Hidden -Wait | Out-Null}else{$visiblePreview.Kill()}}}catch{}; $visiblePreview=$null
  }
  Run-Step 'CERT-004D' 'Comprehensive financial surface certification' {
    $env:MYAI_BASE_URL=$script:certApiBase; $env:MYAI_CFO_API_PORT=[string]$script:certApiPort; $env:MYAI_CFO_CERT_JOB_ID=$JobId
    $r=Invoke-NativeCapture $node @((Join-Path $BuildRoot 'qa\tests\comprehensive-financial-certification.mjs'),'--apiBase',$script:certApiBase) $BuildRoot (Join-Path $jobReportRoot 'comprehensive-financial-certification.stdout.log') (Join-Path $jobReportRoot 'comprehensive-financial-certification.stderr.log'); if($r.ExitCode -ne 0){throw "Comprehensive financial surface certification failed with exit code $($r.ExitCode)."}; if(-not(Test-Path (Join-Path $BuildRoot 'qa\results\comprehensive-financial-certification-latest.json'))){throw 'Comprehensive financial certification result report was not produced.'}; $p=Get-Content (Join-Path $BuildRoot 'qa\results\comprehensive-financial-certification-latest.json') -Raw|ConvertFrom-Json; if($p.status -ne 'PASS'){throw 'Comprehensive financial certification report did not report PASS.'}
  }
  Run-Step 'CERT-005' 'Static/security/backend assurance' { $r=Invoke-NativeCapture $node @((Join-Path $BuildRoot 'qa\run-production-assurance.mjs')) $BuildRoot (Join-Path $jobReportRoot 'assurance.stdout.log') (Join-Path $jobReportRoot 'assurance.stderr.log'); if($r.ExitCode -ne 0){throw "Production assurance failed with exit code $($r.ExitCode)."}; $p=Join-Path $BuildRoot 'qa\results\production-assurance-latest.json'; if(-not(Test-Path $p)){throw 'Production assurance result report was not produced.'} }
  Run-Step 'CERT-005A' 'Synthetic CFO financial scenario matrix' { $r=Invoke-NativeCapture $node @((Join-Path $BuildRoot 'qa\tests\synthetic-cfo-scenario.mjs')) $BuildRoot (Join-Path $jobReportRoot 'synthetic-cfo.stdout.log') (Join-Path $jobReportRoot 'synthetic-cfo.stderr.log'); if($r.ExitCode -ne 0){throw "Synthetic CFO scenario matrix failed with exit code $($r.ExitCode)."}; if(-not(Test-Path (Join-Path $BuildRoot 'qa\results\synthetic-cfo-latest.json'))){throw 'Synthetic CFO scenario result report was not produced.'} }
  Run-Step 'CERT-006' 'Live RAG/grounding/citations/agents/models/OmniRoute certification' { $env:MYAI_BASE_URL=$script:certApiBase; $r=Invoke-NativeCapture $node @((Join-Path $BuildRoot 'qa\tests\live-certification.mjs'),'--apiBase',$script:certApiBase,'--jobId',$JobId) $BuildRoot (Join-Path $jobReportRoot 'live-certification.stdout.log') (Join-Path $jobReportRoot 'live-certification.stderr.log'); if($r.ExitCode -ne 0){throw "Live model/RAG/agent certification failed with exit code $($r.ExitCode)."}; if(-not(Test-Path (Join-Path $BuildRoot 'qa\results\live-certification-latest.json'))){throw 'Live certification result report was not produced.'} }

  $previewPort=Get-FreeLoopbackPort
  Run-Step 'CERT-007' 'Production browser preview launch' {
    $previewLog=Join-Path $BuildRoot 'qa\results\vite-preview.log'; $previewErr=Join-Path $BuildRoot 'qa\results\vite-preview.err.log'; $previewArgs='/d /s /c ""'+$npm+'" run preview -- --host 127.0.0.1 --port '+$previewPort+'"'; $preview=Start-Process -FilePath $env:ComSpec -ArgumentList $previewArgs -WorkingDirectory (Join-Path $BuildRoot 'app\frontend') -RedirectStandardOutput $previewLog -RedirectStandardError $previewErr -PassThru -WindowStyle Hidden
    $ok=$false; for($i=0;$i -lt 60;$i++){if($preview.HasExited){throw "Vite preview exited before readiness: exit=$($preview.ExitCode)"}; try{$r=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$previewPort/" -TimeoutSec 2; if($r.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500}; if(-not $ok){throw 'Production Vite preview did not become reachable.'}
  }
  Run-Step 'CERT-008A' 'Playwright browser runtime' { $r=Invoke-NativeCapture $npm @('exec','--yes','--','playwright','install','chromium') $BuildRoot (Join-Path $jobReportRoot 'playwright-install.stdout.log') (Join-Path $jobReportRoot 'playwright-install.stderr.log'); if($r.ExitCode -ne 0){throw "Playwright Chromium installation failed with exit code $($r.ExitCode)."} }
  Run-Step 'CERT-008' 'Playwright production E2E' {
    $uiApiQuery=[uri]::EscapeDataString($script:certApiBase); $env:MYAI_FRONTEND_URL="http://127.0.0.1:$previewPort/?apiBase=$uiApiQuery"; $env:MYAI_CFO_UI_BASE=$env:MYAI_FRONTEND_URL; $env:MYAI_CFO_UI_URL=$env:MYAI_FRONTEND_URL; $env:MYAI_CFO_API_PORT=[string]$script:certApiPort; $resultsFile=Join-Path $BuildRoot 'qa\results\playwright-results.json';
    $r=Invoke-NativeCapture $npm @('exec','--yes','--','playwright','test','qa/browser/critical-buttons.spec.mjs','qa/browser/all-buttons.spec.mjs','qa/browser/holistic-platform.spec.mjs','--reporter=line,json=qa/results/playwright-results.json','--trace=retain-on-failure','--video=retain-on-failure') $BuildRoot (Join-Path $jobReportRoot 'playwright.stdout.log') (Join-Path $jobReportRoot 'playwright.stderr.log'); if($r.ExitCode -ne 0){throw "Playwright production E2E failed with exit code $($r.ExitCode)."}; if(-not(Test-Path $resultsFile)){throw 'Playwright result report was not produced.'}
    try{
      $raw=Get-Content -Raw -Encoding UTF8 $resultsFile|ConvertFrom-Json
      $stats=$raw.stats
      $expected=[int]$(if($null -ne $stats -and $null -ne $stats.expected){$stats.expected}else{0})
      $unexpected=[int]$(if($null -ne $stats -and $null -ne $stats.unexpected){$stats.unexpected}else{0})
      $skipped=[int]$(if($null -ne $stats -and $null -ne $stats.skipped){$stats.skipped}else{0})
      $flaky=[int]$(if($null -ne $stats -and $null -ne $stats.flaky){$stats.flaky}else{0})
      $duration=[int]$(if($null -ne $stats -and $null -ne $stats.duration){$stats.duration}else{0})
      if($expected -le 0){throw 'Playwright produced no expected-test count.'}
      $wrapped=[ordered]@{schemaVersion='1.0';reportType='MYAI_CFO_PLAYWRIGHT_CERTIFICATION';version=(Get-Content (Join-Path $RootDir 'VERSION.txt') -Raw).Trim();jobId=$JobId;generatedAt=[DateTime]::UtcNow.ToString('o');status=if($unexpected -eq 0){'PASS'}else{'FAIL'};stats=@{expected=$expected;unexpected=$unexpected;failures=$unexpected;skipped=$skipped;flaky=$flaky;durationMs=$duration};playwright=$raw}
      $wrapped|ConvertTo-Json -Depth 40|Set-Content -Encoding UTF8 $resultsFile
    }catch{throw "Playwright result normalization failed: $($_.Exception.Message)"}
  }

  Run-Step 'CERT-008B' 'Audit trail forensic verification' {
    $auditFile=Join-Path $BuildRoot 'app\.myai-cfo\audit\acceptance.jsonl'; if(-not(Test-Path $auditFile)){throw 'Audit ledger was not produced by certification.'}; $r=Invoke-NativeCapture $node @((Join-Path $BuildRoot 'qa\tests\audit-forensics-suite.mjs'),$auditFile) $BuildRoot (Join-Path $jobReportRoot 'audit-forensics.stdout.log') (Join-Path $jobReportRoot 'audit-forensics.stderr.log'); if($r.ExitCode -ne 0){throw "Audit forensics failed with exit code $($r.ExitCode)."}; $outPath=Join-Path $BuildRoot 'qa\results\audit-forensics-latest.json'; if(-not($r.Stdout.Trim())){throw 'Audit forensics produced empty output.'}; Set-Content -Encoding UTF8 $outPath $r.Stdout
  }
  Run-Step 'CERT-009' 'Release assurance and final gate' { $env:MYAI_CFO_CERT_JOB_ID=$JobId; $r=Invoke-NativeCapture $node @((Join-Path $BuildRoot 'qa\release-gate.mjs')) $BuildRoot (Join-Path $jobReportRoot 'release-gate.stdout.log') (Join-Path $jobReportRoot 'release-gate.stderr.log'); if($r.ExitCode -ne 0){throw "Release gate returned HOLD (exit $($r.ExitCode))."}; if($r.Stdout -notmatch '"releaseGate"\s*:\s*"GO"'){throw 'Release gate completed without explicit GO evidence.'} }

  Save-CertState 'CERTIFIED'
  $mandatoryFails=@($script:CertSteps | Where-Object {$_.status -eq 'FAIL'})
  $mandatoryNotRun=@($script:CertSteps | Where-Object {$_.status -eq 'NOT_RUN'})
  if($mandatoryFails.Count -gt 0 -or $mandatoryNotRun.Count -gt 0){
    $script:FinalExitCode=2; $certificationSucceeded=$false; $summary="$($mandatoryFails.Count) failed stage(s); $($mandatoryNotRun.Count) not-run stage(s)."; Save-CertState 'HOLD' $summary; Write-Host "=== MYAI CFO FULL PRODUCTION CERTIFICATION: HOLD ($summary) ===" -ForegroundColor Yellow
  } else {
    $script:FinalExitCode=0
    $certificationSucceeded=$true
    Write-Host '=== MYAI CFO FULL PRODUCTION CERTIFICATION: GO ===' -ForegroundColor Green
  }
}
catch {
  $failedStep=$script:CertSteps | Where-Object {$_.status -eq 'FAIL'} | Select-Object -Last 1
  $failedStepId=if($failedStep){[string]$failedStep.stepId}else{'unknown step'}
  try{Write-SkippedSteps $failedStepId "Could not execute because certification prerequisites were not established after $failedStepId."}catch{}
  try{Save-CertState 'HOLD' $_.Exception.Message}catch{}
  $script:FinalExitCode=2
  Write-Host "=== MYAI CFO FULL PRODUCTION CERTIFICATION: HOLD ===" -ForegroundColor Yellow
}
finally {
  try{Collect-CertArtifacts}catch{}
  try{if($visiblePreview -and -not $visiblePreview.HasExited){if($env:OS -eq 'Windows_NT'){Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c',"taskkill /PID $($visiblePreview.Id) /T /F") -WindowStyle Hidden -Wait | Out-Null}else{$visiblePreview.Kill()}}}catch{}
  try{if($preview -and -not $preview.HasExited){if($env:OS -eq 'Windows_NT'){Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/s','/c',"taskkill /PID $($preview.Id) /T /F") -WindowStyle Hidden -Wait | Out-Null}else{$preview.Kill()}}}catch{}
  Stop-CertBackend
  Remove-Item Env:MYAI_CFO_CERT_TEARDOWN -ErrorAction SilentlyContinue
  try{if(Test-Path $certTempRoot){Remove-Item -Recurse -Force $certTempRoot -ErrorAction SilentlyContinue}}catch{}
}
exit $script:FinalExitCode
