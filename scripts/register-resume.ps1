# register-resume.ps1 - register the autonomous resume task.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI - see register-heartbeat.ps1).
#
# WHAT THIS TASK DOES - read before running it
#   Every 15 minutes it runs src/rs.mjs, which may start
#   `claude --resume <sessionId> -p` for any session you switched "resume" on in
#   the UI. That spends tokens on the signed-in Claude Code account and can edit
#   and commit files with NO human watching.
#
#   It is not unconditional. rs.mjs refuses to run unless every guard passes:
#     - the session is switched on in state/targets.json (the UI writes it)
#     - the session process is NOT running (checked by pid - never touch a
#       session a human is using)
#     - no activity in the last N minutes
#     - there is a resume point (a tracker with a doing/todo step, or an
#       explicit instruction you typed)
#     - daily run count, daily dollar cap, minimum interval, and the
#       consecutive-failure circuit breaker all allow it
#     - it can take the per-session lock
#   Anything blocked is logged and exits 0, so the task history stays clean.
#
#   Turn it off at any time: unregister this task, or switch resume off in the UI.
#
# Runs as the CURRENT USER with Interactive logon so it can read the account
# credentials under %USERPROFILE%\.claude. No API key is used.

$ErrorActionPreference = 'Stop'

$TaskName = 'EasyAI-RetrySession-Resume'
$Root     = Split-Path -Parent $PSScriptRoot
$Script   = Join-Path $Root 'src\rs.mjs'
$Minutes  = 15

if (-not (Test-Path $Script)) { throw "entry point not found: $Script" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node was not found on PATH.' }

Write-Host "task   : $TaskName"
Write-Host "node   : $node"
Write-Host "script : $Script"
Write-Host "every  : $Minutes minute(s)"
Write-Host ''
Write-Host 'This task can spend tokens and edit files unattended.' -ForegroundColor Yellow
Write-Host 'Guards are listed at the top of this script.' -ForegroundColor Yellow

# Route through the windowless launcher (start.exe --hidden) so node never gets
# a console window (see register-heartbeat.ps1 for the measurement).
. (Join-Path $PSScriptRoot 'launcher-lib.ps1')
$hidden = Get-HiddenLauncher $Root
if ($hidden) {
  $action = New-ScheduledTaskAction -Execute $hidden -WorkingDirectory $Root `
      -Argument ($HiddenSwitch + ' "' + $node + '" "' + $Script + '"')
  Write-Host "window : hidden (start.exe $HiddenSwitch)"
} else {
  $action = New-ScheduledTaskAction -Execute $node -Argument "`"$Script`"" -WorkingDirectory $Root
  Write-Host "window : VISIBLE - start.exe is missing or too old (no $HiddenSwitch) - .\scripts\build-exe.ps1" -ForegroundColor Yellow
}

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3) `
    -RepetitionInterval (New-TimeSpan -Minutes $Minutes)

# ExecutionTimeLimit stays unlimited on purpose: rs.mjs enforces its own
# wall-clock timeout per run (the per-project resume timeout in config, default
# 30 min) and kills the process tree. Two competing timeouts would make
# failures harder to read.
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
    -Description 'RetrySession: resume interrupted Claude Code sessions unattended (guarded; every 15 min).' | Out-Null

Write-Host ''
Write-Host 'registered.' -ForegroundColor Green
Write-Host '  NOT started now - the first firing happens in ~3 minutes.'
Write-Host "  dry run: node `"$Root\src\resume.mjs`" --dry-run"
Write-Host "  status : node `"$Root\src\resume.mjs`" --status"
Write-Host "  remove : Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
