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

$action = New-ScheduledTaskAction -Execute $node `
    -Argument "`"$Script`" --port $Port" -WorkingDirectory $Root

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

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal `
    -Description 'RetrySession: local status UI (127.0.0.1 only).' | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'registered and started.' -ForegroundColor Green
Write-Host "  open   : http://127.0.0.1:$Port"
Write-Host "  remove : Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
