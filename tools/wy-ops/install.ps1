# WY Ops installer entry point (Windows PowerShell 5.1). All logic lives in lib/install.js.
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File tools\wy-ops\install.ps1 setup
#   powershell -ExecutionPolicy Bypass -File tools\wy-ops\install.ps1 global | doctor | deploy | rollback [version] | cleanup-legacy
# This file is ASCII only on purpose: PowerShell 5.1 reads BOM-less .ps1 files in the ANSI code page.
$ErrorActionPreference = 'Continue'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'node was not found on PATH. Install Node.js (18+) and run this again.'
  exit 1
}
& node (Join-Path $PSScriptRoot 'lib\install.js') @args
exit $LASTEXITCODE
