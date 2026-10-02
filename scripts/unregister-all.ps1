# unregister-all.ps1 - remove every RetrySession scheduled task.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# This is the off switch for everything that runs outside a Claude Code session,
# AND it forgets the registrations. stop.bat (stop-all.ps1) only disables them.
# It does NOT touch state/ - your target list, logs and history stay on disk, so
# re-registering later picks up where you left off.

$ErrorActionPreference = 'Continue'

# Stop everything first, with the same script stop.bat uses - it ends a resume
# run in flight too, which this script used to leave running.
# Measured: unregistering a task does not kill an instance already running.
& (Join-Path $PSScriptRoot 'stop-all.ps1') -By 'uninstall' | Out-Host

$Names = @(
  'EasyAI-RetrySession-Heartbeat',
  'EasyAI-RetrySession-Resume',
  'EasyAI-RetrySession-UI',
  'EasyAI-RetrySession-Tray'
)

foreach ($n in $Names) {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  if ($t) {
    Unregister-ScheduledTask -TaskName $n -Confirm:$false
    Write-Host "removed : $n" -ForegroundColor Yellow
  } else {
    Write-Host "absent  : $n"
  }
}

Write-Host ''
Write-Host 'done. state/ was left untouched (targets, logs, history).'
Write-Host 'come back with: start.bat (registers monitor, UI and tray again)'
