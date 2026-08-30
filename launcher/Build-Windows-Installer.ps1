# Packaging contract for the future self-contained Windows build.
# This script intentionally does not pretend to create a Windows EXE on a non-Windows host.
$ErrorActionPreference='Stop'
Write-Host 'MYAI CFO Windows packaging contract'
Write-Host '1. Build frontend: npm run build'
Write-Host '2. Bundle portable Node runtime'
Write-Host '3. Bundle kernel, data, model gateway and launcher'
Write-Host '4. Build/sign the Windows launcher/installer'
Write-Host 'The current 1.24.26 package is a development build, not yet the final signed installer.'
