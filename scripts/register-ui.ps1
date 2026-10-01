# register-ui.ps1 - keep the status UI running, starting at logon.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI - see register-heartbeat.ps1).
#
# The UI binds to 127.0.0.1 only. It can trigger a resume run, so it must never
# be reachable from another machine - do not change the bind address in
# src/ui/server.mjs.
#
# StartWhenAvailable + a logon trigger means: if you were logged off, it starts
# on next logon; if the task was missed, it runs as soon as it can.
#
#   -NoStart   register only: do NOT free the port and do NOT start the task.
#              The status UI's "prepare this PC" button calls this script FROM
#              the server that holds port 7345 - freeing the port would kill the
#              very process waiting for this script, and the button would never
#              get its answer. The running server keeps serving; the task takes
#              over at the next logon.

param([switch]$NoStart)

$ErrorActionPreference = 'Stop'

$TaskName = 'EasyAI-RetrySession-UI'
$Root     = Split-Path -Parent $PSScriptRoot
$Script   = Join-Path $Root 'src\ui\server.mjs'
$Port     = 7345

if (-not (Test-Path $Script)) { throw "server not found: $Script" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node was not found on PATH.' }

Write-Host "task   : $TaskName"
Write-Host "node   : $node"
Write-Host "script : $Script"
Write-Host "url    : http://127.0.0.1:$Port"

# IMPORTANT: route through runhidden.exe so node never gets a console window.
#
# This is the window the user kept seeing: a task whose action is node.exe gets
# a conhost.exe child under an interactive logon, and the server runs forever,
# so the console stays on screen forever. The task's -Hidden setting does not
# prevent it - that only hides the task in the Task Scheduler list.
$hidden = Join-Path $Root 'runhidden.exe'
if (Test-Path $hidden) {
  $action = New-ScheduledTaskAction -Execute $hidden -WorkingDirectory $Root `
      -Argument ('"' + $node + '" "' + $Script + '" --port ' + $Port)
  Write-Host 'window : hidden (runhidden.exe)'
} else {
  $action = New-ScheduledTaskAction -Execute $node `
      -Argument "`"$Script`" --port $Port" -WorkingDirectory $Root
  Write-Host 'window : VISIBLE - runhidden.exe is missing (.\scripts\build-exe.ps1)' -ForegroundColor Yellow
}

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

# A server is meant to keep running, so no execution time limit and do not stop
# it when the machine goes idle or onto battery.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew `
    -Hidden

$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

# ---- free the port before registering ----------------------------------
# Measured: unregistering a task does NOT kill an instance that is already
# running. The old server keeps the port, the freshly started one dies with
# EADDRINUSE, and the task looks "registered but failing" for no visible reason.
# It also means a code change never takes effect, because the live process still
# holds the modules it loaded at startup.
if ($NoStart) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
      -Settings $settings -Principal $principal `
      -Description 'RetrySession: local status UI (127.0.0.1 only).' | Out-Null
  Write-Host ''
  Write-Host 'registered (not started - the running server keeps the port; the task starts at next logon).' -ForegroundColor Green
  exit 0
}

$holders = @()
try {
  $holders = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
             Select-Object -ExpandProperty OwningProcess -Unique
} catch { }

foreach ($procId in $holders) {
  $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if ($p) {
    Write-Host "freeing port $Port - stopping pid $procId ($($p.ProcessName))" -ForegroundColor Yellow
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
}
if ($holders.Count -gt 0) { Start-Sleep -Seconds 2 }

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description 'RetrySession: local status UI (127.0.0.1 only).' | Out-Null

Start-ScheduledTask -TaskName $TaskName

# Confirm it actually answers. "Registered" is not the same as "serving" - that
# distinction is the whole lesson of this project.
$ok = $false
foreach ($i in 1..20) {
  Start-Sleep -Milliseconds 700
  try {
# Timeout is 10s, not 5s. A DEAD server is refused immediately (connection
# refused) - it does not time out. A timeout only means BUSY: /api/status does
# synchronous work (CLI + scheduler queries) and blocks the single node thread,
# so /api/ping was measured at up to 3.7s even after the async fix (7.9s before).
# Calling a busy-but-alive server "not answering" is the exact mistake that once
# left the tray unstarted. Slow is not dead.
    # /api/ping computes nothing. /api/tray builds the whole status (11.7s cold,
    # measured) and would time out here on a server that is perfectly fine -
    # the same false reading that once reported a healthy server as down and,
    # in start.ps1, took the tray with it.
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/ping" -TimeoutSec 10 -UseBasicParsing
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}
if (-not $ok) {
  Write-Host ''
  Write-Host "registered, but http://127.0.0.1:$Port is not answering yet." -ForegroundColor Red
  Write-Host '  check: Get-ScheduledTaskInfo -TaskName ' + $TaskName
  exit 1
}

Write-Host ''
Write-Host 'registered and started.' -ForegroundColor Green
Write-Host "  open   : http://127.0.0.1:$Port"
Write-Host "  remove : Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
