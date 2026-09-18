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
  'EasyAI-RetrySession-UI',
  'EasyAI-RetrySession-Tray'
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

# Measured: unregistering a task does not kill an instance already running.
# The UI server would keep holding port 7345 and the tray would keep its icon,
# so "unregistered" would not mean "stopped".
$port = 7345
try {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      Write-Host "stopping server on port $port - pid $_" -ForegroundColor Yellow
      Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
    }
} catch { }

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*tray.ps1*' } |
  ForEach-Object {
    Write-Host "stopping tray - pid $($_.ProcessId)" -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host ''
Write-Host 'done. state/ was left untouched (targets, logs, history).'
Write-Host 'a resume run already in flight is not stopped - check: Get-Process node'
