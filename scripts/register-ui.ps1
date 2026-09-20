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
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/tray" -TimeoutSec 3 -UseBasicParsing
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
