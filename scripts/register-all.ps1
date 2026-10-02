# register-all.ps1 - register monitor + UI, and optionally the resumer.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# Default is deliberately asymmetric:
#   monitor + UI + tray -> registered (they only read and record; nothing is spent)
#   resumer             -> NOT registered unless you pass -WithResume
#
# The resumer spends tokens and edits files with no human watching. Opting into
# that should be an explicit word on the command line, not a default.
#
#   .\scripts\register-all.ps1                # monitor + UI + tray
#   .\scripts\register-all.ps1 -WithResume    # all four

param(
  [switch]$WithResume,
  [switch]$NoTray
)

$ErrorActionPreference = 'Stop'

# Every task runs through start.exe --hidden. It is a build artifact (not in
# git), so a fresh clone has none, and a copy built before 2026-10-02 does not
# know --hidden. Registering without it would make console-window tasks - so
# build it first. A failed build is not fatal: each register script then says
# "window : VISIBLE" out loud instead of hiding the problem.
. (Join-Path $PSScriptRoot 'launcher-lib.ps1')
if (-not (Get-HiddenLauncher (Split-Path -Parent $PSScriptRoot))) {
  Write-Host "start.exe is missing or too old (no $HiddenSwitch) - building it first" -ForegroundColor Yellow
  try { & (Join-Path $PSScriptRoot 'build-exe.ps1') } catch { Write-Host "build failed: $($_.Exception.Message)" -ForegroundColor Red }
  Write-Host ''
}

& (Join-Path $PSScriptRoot 'register-heartbeat.ps1')
Write-Host ''
& (Join-Path $PSScriptRoot 'register-ui.ps1')

if (-not $NoTray) {
  Write-Host ''
  & (Join-Path $PSScriptRoot 'register-tray.ps1')
}

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
& (Join-Path $PSScriptRoot 'shortcut.ps1')

Write-Host ''
& (Join-Path $PSScriptRoot 'status.ps1')
