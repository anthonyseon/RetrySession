# status.ps1 - is anything actually running outside a Claude Code session?
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# Two questions have different answers and different fixes, so they are printed
# side by side (this distinction is the lesson from the original outage):
#   1. is the task REGISTERED?   -> if not, re-register
#   2. is the RECORD fresh?      -> if not, the task exists but is failing
# A monitor that only answers one of these sends you to the wrong fix.

$ErrorActionPreference = 'Continue'

$Root  = Split-Path -Parent $PSScriptRoot
$Names = @(
  @{ Key = 'monitor'; Name = 'EasyAI-RetrySession-Heartbeat' },
  @{ Key = 'resume ' ; Name = 'EasyAI-RetrySession-Resume'    },
  @{ Key = 'ui     ' ; Name = 'EasyAI-RetrySession-UI'        },
  @{ Key = 'tray   ' ; Name = 'EasyAI-RetrySession-Tray'      }
)

Write-Host '== scheduled tasks =='
foreach ($e in $Names) {
  $t = Get-ScheduledTask -TaskName $e.Name -ErrorAction SilentlyContinue
  if (-not $t) {
    Write-Host ("{0} : NOT REGISTERED" -f $e.Key) -ForegroundColor Red
    continue
  }
  $i = Get-ScheduledTaskInfo -TaskName $e.Name -ErrorAction SilentlyContinue
  $color = if ($i -and $i.LastTaskResult -eq 0) { 'Green' } else { 'Yellow' }
  Write-Host ("{0} : {1,-8} last={2} result={3} next={4}" -f `
      $e.Key, $t.State, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime) -ForegroundColor $color
}

# "registered" is not "serving" - check the two live pieces for real.
Write-Host ''
Write-Host '== actually running =='

# Liveness goes to /api/ping, which computes nothing.
#
# Measured mistake: this used to call /api/tray with a 4 second timeout. That
# endpoint builds the whole status, and on a cold cache it took 11.3 seconds
# (0.65-3.3s warm) - so a perfectly healthy server was reported as "NOT
# answering". A monitor that cries wolf is worse than no monitor.
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7345/api/ping' -TimeoutSec 10 -UseBasicParsing
  if ($r.StatusCode -eq 200) {
    $up = ($r.Content | ConvertFrom-Json).uptimeSec
    Write-Host ("server  : answering on 127.0.0.1:7345 (up {0}s)" -f $up) -ForegroundColor Green
  }
} catch {
  Write-Host 'server  : NOT answering on 127.0.0.1:7345' -ForegroundColor Red
}
$m = New-Object System.Threading.Mutex($false, 'Global\EasyAI-RetrySession-Tray')
if ($m.WaitOne(0)) {
  Write-Host 'tray    : not running' -ForegroundColor Yellow
  $m.ReleaseMutex()
} else {
  Write-Host 'tray    : running' -ForegroundColor Green
}
$m.Dispose()

Write-Host ''
Write-Host '== record freshness (fail-closed: unknown counts as dead) =='
& node (Join-Path $Root 'src\heartbeat.mjs') --check
$hb = $LASTEXITCODE

Write-Host ''
Write-Host '== resume budget =='
& node (Join-Path $Root 'src\resume.mjs') --status

Write-Host ''
if ($hb -ne 0) {
  Write-Host 'record is stale. If the task IS registered above, it is running but failing -' -ForegroundColor Red
  Write-Host 'read state\sessions\<id>\heartbeat.log and the Task Scheduler history.' -ForegroundColor Red
} else {
  Write-Host 'ok.' -ForegroundColor Green
}
Write-Host 'ui: http://127.0.0.1:7345'
