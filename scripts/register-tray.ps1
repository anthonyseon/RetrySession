# register-tray.ps1 - keep the tray icon running, starting at logon.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# The tray is how you find out something broke without having a window open.
# It polls /api/tray, colours its dot, and raises a balloon when the state
# CHANGES (stalled monitor, blocked resume, usage limit, server down).
#
# No cmd.exe: the action runs powershell.exe directly, with -WindowStyle Hidden
# so no console ever appears.

$ErrorActionPreference = 'Stop'

$TaskName = 'EasyAI-RetrySession-Tray'
$Root     = Split-Path -Parent $PSScriptRoot
$Script   = Join-Path $Root 'scripts\tray.ps1'

if (-not (Test-Path $Script)) { throw "tray script not found: $Script" }

# Use the same powershell.exe that is running this script - do not rely on PATH.
$psExe = (Get-Process -Id $PID).Path
if (-not $psExe) { $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" }

Write-Host "task   : $TaskName"
Write-Host "shell  : $psExe"
Write-Host "script : $Script"

# Stop an instance that is already running, otherwise the new one exits at once
# on the single-instance mutex and the task looks like it failed.
#
# Measured bug: matching '*tray.ps1*' also matches THIS script's own command
# line ('...\register-tray.ps1'), so the registration killed itself halfway
# through. Match the path separator, and never match our own process.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.ProcessId -ne $PID -and
    $_.CommandLine -and
    # require the -File form so a diagnostic command that merely MENTIONS
    # tray.ps1 is not mistaken for the tray itself
    $_.CommandLine -like '*-File*\tray.ps1*'
  } |
  ForEach-Object {
    Write-Host "stopping existing tray - pid $($_.ProcessId)" -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Milliseconds 500

$action = New-ScheduledTaskAction -Execute $psExe -WorkingDirectory $Root -Argument (
  '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '"'
)

$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"

# A tray lives for the whole session: no time limit, and do not stop it when the
# machine goes idle or onto battery.
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
    -Description 'RetrySession: tray icon - watch status and notify on change.' | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

# Liveness by MUTEX, not by command-line matching.
# The tray holds 'Global\EasyAI-RetrySession-Tray' for its whole life, so if we
# cannot take it, it is running. Command-line matching gives false positives:
# any process whose command line merely mentions tray.ps1 (a diagnostic query,
# for instance) looks like the tray.
$probe = New-Object System.Threading.Mutex($false, 'Global\EasyAI-RetrySession-Tray')
$alive = -not $probe.WaitOne(0)
if (-not $alive) { $probe.ReleaseMutex() }
$probe.Dispose()

# ---- make the icon actually visible ------------------------------------
# Windows 11 hides every NEW tray icon in the overflow flyout by default, so a
# freshly registered tray is invisible until the user digs through Taskbar
# settings. Measured: our entry existed with IsPromoted unset.
#
# IsPromoted=1 pins it to the taskbar. The key is hashed per executable path, so
# this promotes PowerShell-hosted tray icons generally - in practice that is
# only ours. Best effort: never fail the registration over a cosmetic setting.
try {
  $base = 'HKCU:\Control Panel\NotifyIconSettings'
  if (Test-Path $base) {
    $promoted = 0
    Get-ChildItem $base -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      if ($p.ExecutablePath -like '*\WindowsPowerShell\*\powershell.exe') {
        Set-ItemProperty $_.PSPath -Name 'IsPromoted' -Value 1 -Type DWord -ErrorAction SilentlyContinue
        $promoted++
      }
    }
    if ($promoted -gt 0) { Write-Host "tray icon pinned to the taskbar ($promoted entry/entries)" -ForegroundColor Green }
  }
} catch { }

Write-Host ''
if ($alive) {
  Write-Host 'registered and started - look for the dot in the notification area.' -ForegroundColor Green
  Write-Host '  if it is hidden: Taskbar settings > Other system tray icons > RetrySession = On'
} else {
  Write-Host 'registered, but the tray process is not running.' -ForegroundColor Red
  Write-Host "  run it in the foreground to see the error:"
  Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$Script`""
}
Write-Host "  remove : Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
