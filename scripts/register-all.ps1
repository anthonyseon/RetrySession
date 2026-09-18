# register-all.ps1 - register monitor + UI, and optionally the resumer.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# Default is deliberately asymmetric:
#   monitor + UI  -> registered (they only read and record; nothing is spent)
#   resumer       -> NOT registered unless you pass -WithResume
#
# The resumer spends tokens and edits files with no human watching. Opting into
# that should be an explicit word on the command line, not a default.
#
#   .\scripts\register-all.ps1                # monitor + UI
#   .\scripts\register-all.ps1 -WithResume    # all three

param(
  [switch]$WithResume
)

$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'register-heartbeat.ps1')
Write-Host ''
& (Join-Path $PSScriptRoot 'register-ui.ps1')

if ($WithResume) {
  Write-Host ''
  & (Join-Path $PSScriptRoot 'register-resume.ps1')
} else {
  Write-Host ''
  Write-Host 'resumer NOT registered.' -ForegroundColor Yellow
  Write-Host '  It would run `claude --resume` unattended - tokens and file edits.'
  Write-Host '  Add it with: .\scripts\register-all.ps1 -WithResume'
  Write-Host '  Or directly: .\scripts\register-resume.ps1'
}

Write-Host ''
& (Join-Path $PSScriptRoot 'status.ps1')
