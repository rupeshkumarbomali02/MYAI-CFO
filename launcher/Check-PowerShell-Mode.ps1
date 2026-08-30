Write-Host "PowerShell Language Mode: $($ExecutionContext.SessionState.LanguageMode)" -ForegroundColor Cyan
Write-Host "Execution Policy: $(Get-ExecutionPolicy -Scope Process)" -ForegroundColor Cyan
Read-Host "Press Enter to close"
