# shortcut.ps1 - create Start Menu (and optionally Desktop) shortcuts.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# The shortcut is what makes this feel like an app: Start Menu search finds
# "RetrySession", and the window can be pinned to the taskbar.
#
# It launches powershell.exe -WindowStyle Hidden -File open-app.ps1, so no cmd
# window ever flashes. open-app.ps1 then opens the UI in a chromeless
# Edge/Chrome app window.

param(
  [switch]$Desktop,
  [int]$Port = 7345
)

$ErrorActionPreference = 'Stop'

$Root   = Split-Path -Parent $PSScriptRoot
$Name   = 'RetrySession'
$Opener = Join-Path $Root 'scripts\open-app.ps1'

$psExe = (Get-Process -Id $PID).Path
if (-not $psExe) { $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" }

# Use Edge's icon so the shortcut does not show a generic PowerShell logo.
$iconSrc = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$targets = @(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
if ($Desktop) { $targets += [Environment]::GetFolderPath('Desktop') }

$wsh = New-Object -ComObject WScript.Shell

foreach ($dir in $targets) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $lnkPath = Join-Path $dir "$Name.lnk"

  $lnk = $wsh.CreateShortcut($lnkPath)
  $lnk.TargetPath = $psExe
  $lnk.Arguments  = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
                    $Opener + '" -Port ' + $Port
  $lnk.WorkingDirectory = $Root
  $lnk.WindowStyle = 7           # minimized, so the launcher never shows
  $lnk.Description = 'RetrySession - watch and resume Claude Code sessions'
  if ($iconSrc) { $lnk.IconLocation = "$iconSrc,0" }
  $lnk.Save()

  Write-Host "shortcut : $lnkPath" -ForegroundColor Green
}

[System.Runtime.InteropServices.Marshal]::ReleaseComObject($wsh) | Out-Null

Write-Host ''
Write-Host 'Start Menu > search "RetrySession" to open the window.'
if (-not $Desktop) { Write-Host 'Add a desktop copy with: .\scripts\shortcut.ps1 -Desktop' }
