# open-app.ps1 - open the status UI as a chromeless app window.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# Why a browser in --app mode instead of a packaged desktop app
#   This tool must start when everything else is broken, so it carries no
#   dependencies - no npm install, no build step. Edge/Chrome in --app mode gives
#   a window with no address bar and no tabs, its own taskbar icon, and it is
#   pinnable, which is what "GUI" actually needs here. The UI itself is the same
#   code the browser already serves.
#
# A dedicated --user-data-dir matters: without it the window joins the user's
# normal browsing profile and Windows groups it under the browser's taskbar icon
# instead of giving RetrySession its own.
#
# No cmd.exe anywhere - Start-Process launches the executable directly.

param(
  [int]$Port = 7345,
  [switch]$NoWait     # skip waiting for the server to answer
)

$ErrorActionPreference = 'Stop'

$Root    = Split-Path -Parent $PSScriptRoot
$Url     = "http://127.0.0.1:$Port"
$Profile = Join-Path $env:LOCALAPPDATA 'RetrySession\browser-profile'

# ---- make sure the server is up (the UI task may still be starting) ----
if (-not $NoWait) {
  $ok = $false
  foreach ($i in 1..20) {
    try {
      $r = Invoke-WebRequest -Uri "$Url/api/status" -TimeoutSec 3 -UseBasicParsing
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ok) {
    Write-Host "server is not answering at $Url - trying to start the UI task..." -ForegroundColor Yellow
    Start-ScheduledTask -TaskName 'EasyAI-RetrySession-UI' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    try {
      $null = Invoke-WebRequest -Uri "$Url/api/status" -TimeoutSec 5 -UseBasicParsing
    } catch {
      Write-Host "still not answering. Start it by hand:" -ForegroundColor Red
      Write-Host "  node `"$Root\src\ui\server.mjs`""
      exit 1
    }
  }
}

# ---- find a Chromium browser (Edge first - always present on Win11) ----
$candidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $browser) {
  # No Chromium browser: fall back to the default handler. It opens as a normal
  # tab rather than an app window, which is worse but still usable.
  Write-Host 'no Edge/Chrome found - opening in the default browser (tabbed).' -ForegroundColor Yellow
  Start-Process $Url
  exit 0
}

New-Item -ItemType Directory -Force -Path $Profile | Out-Null

$args = @(
  "--app=$Url",
  "--user-data-dir=$Profile",
  '--window-size=1500,980',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter'
)

Start-Process -FilePath $browser -ArgumentList $args
Write-Host "opened $Url as an app window."
