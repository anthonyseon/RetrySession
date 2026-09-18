# unregister-all.ps1 - remove every RetrySession scheduled task.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# This is the off switch for everything that runs outside a Claude Code session.
# It does NOT touch state/ - your target list, logs and history stay on disk, so
# re-registering later picks up where you left off.
#
# It also does not stop a resume run that is already in flight. Check with:
#   Get-Process node | Where-Object { $_.Path -like '*nodejs*' }

$ErrorActionPreference = 'Continue'

$Names = @(
  'EasyAI-RetrySession-Heartbeat',
  'EasyAI-RetrySession-Resume',
  'EasyAI-RetrySession-UI'
)

foreach ($n in $Names) {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  if ($t) {
    Stop-ScheduledTask   -TaskName $n -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $n -Confirm:$false
    Write-Host "removed : $n" -ForegroundColor Yellow
  } else {
    Write-Host "absent  : $n"
  }
}

Write-Host ''
Write-Host 'done. state/ was left untouched (targets, logs, history).'
