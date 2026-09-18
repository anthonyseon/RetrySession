# register-heartbeat.ps1 - register the 5-minute monitor task.
#
# ASCII ONLY. Do not put Korean characters in this file.
#   PowerShell 5.1 reads .ps1 as ANSI, so a single multi-byte character kills the
#   parser (measured). That is also why the script it launches is src/hb.mjs and
#   not the Korean-commented implementation file - the path must be ASCII too.
#
# Settings below are not arbitrary - they come from a measured 9-hour outage:
#   a long-lived setInterval froze while the PC stayed awake and the process
#   stayed alive. The fix was to stop using a timer and let the OS start a fresh
#   process every 5 minutes. Keep -MultipleInstances IgnoreNew so a slow run
#   never stacks up.
#
# Runs as the CURRENT USER with Interactive logon. That is required:
#   the resumer authenticates as the Claude Code account signed in under
#   %USERPROFILE%\.claude - a different account or S4U logon cannot read it.

$ErrorActionPreference = 'Stop'

$TaskName = 'EasyAI-RetrySession-Heartbeat'
$Root     = Split-Path -Parent $PSScriptRoot
$Script   = Join-Path $Root 'src\hb.mjs'
$Minutes  = 5

if (-not (Test-Path $Script)) { throw "entry point not found: $Script" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node was not found on PATH. Install Node.js or add it to PATH.' }

Write-Host "task   : $TaskName"
Write-Host "node   : $node"
Write-Host "script : $Script"
Write-Host "every  : $Minutes minute(s)"

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$Script`"" -WorkingDirectory $Root

# No RepetitionDuration: on Windows 10/11 omitting it means "repeat indefinitely".
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $Minutes)

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
    -Description 'RetrySession: record where each watched Claude Code session stopped (every 5 min, fresh process).' | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'registered and started.' -ForegroundColor Green
Write-Host "  verify : node `"$Root\src\heartbeat.mjs`" --check"
Write-Host "  remove : Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
