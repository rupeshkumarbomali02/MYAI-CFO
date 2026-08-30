param(
  [switch]$Install,
  [string]$Python = "python"
)
$ErrorActionPreference = "Stop"
Write-Host "MYAI CFO PdfTable optional table extractor"
if(-not $Install){
  Write-Host "Dry mode. Re-run with -Install to provision CycloneBoy/pdf_table and its Python dependencies."
  Write-Host "The core CFO extraction path does not depend on PdfTable."
  exit 0
}
& $Python -m pip install --upgrade pip
& $Python -m pip install "git+https://github.com/CycloneBoy/pdf_table.git"
if($LASTEXITCODE -ne 0){ throw "PdfTable installation failed." }
Write-Host "PdfTable installed. The MYAI CFO ensemble will use it as an optional independent table signal when available."
