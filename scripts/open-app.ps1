# open-app.ps1 - open the status UI as a chromeless app window (only ever one).
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# Why a browser in --app mode instead of a packaged desktop app
#   This tool must start when everything else is broken, so it carries no
#   dependencies - no npm install, no build step. Edge/Chrome in --app mode gives
#   a window with no address bar and no tabs, its own taskbar icon, and it is
#   pinnable, which is what "GUI" actually needs here.
#
# A dedicated --user-data-dir matters twice over:
#   1. without it the window joins the user's normal browsing profile and Windows
#      groups it under the browser's taskbar icon instead of its own;
#   2. it is how this script RECOGNISES its own window. Only the status window
#      ever uses that profile, so any visible window owned by a browser running
#      it is ours - no title matching, which breaks on encoding and on locale.
#
# SINGLE WINDOW (measured)
#   `--app=<url>` opens a NEW window on every invocation. Chromium reuses the
#   browser PROCESS for the same profile, so counting processes hides this -
#   measured 3 RetrySession windows under a single pid 28968 after three calls.
#   Every entry point (start.exe, the tray, the shortcut) comes through here, so
#   this is the one place that has to enforce it: if a window already exists,
#   bring it to the front and close any extras instead of adding another.
#
# No cmd.exe anywhere - Start-Process launches the executable directly.

param(
  [int]$Port = 7345,
  [switch]$NoWait,        # skip waiting for the server to answer
  [switch]$KeepExtra,     # do not close duplicate windows (diagnostics)
  [switch]$Reload         # close the open window and open a fresh one (see below)
)

$ErrorActionPreference = 'Stop'

$Root    = Split-Path -Parent $PSScriptRoot
$Url     = "http://127.0.0.1:$Port"
$UserDir = Join-Path $env:LOCALAPPDATA 'RetrySession\browser-profile'

# ---- win32 -------------------------------------------------------------
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RsWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLengthW(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
}
'@

$SW_RESTORE = 9
$WM_CLOSE   = 0x0010

# Browser processes running OUR profile. That set is the whole discriminator.
function Get-AppPids {
  $needle = '--user-data-dir=' + $UserDir
  $out = @()
  foreach ($name in 'msedge.exe', 'chrome.exe') {
    $out += Get-CimInstance Win32_Process -Filter "Name='$name'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } |
            Select-Object -ExpandProperty ProcessId
  }
  return @($out | Sort-Object -Unique)
}

# Visible, titled top-level windows belonging to those processes.
function Get-AppWindows($appPids) {
  if (-not $appPids -or $appPids.Count -eq 0) { return @() }
  $set = @{}
  foreach ($p in $appPids) { $set[[uint32]$p] = $true }

  $found = New-Object System.Collections.ArrayList
  $cb = [RsWin+EnumProc]{
    param($h, $l)
    if ([RsWin]::IsWindowVisible($h)) {
      $wp = 0
      [void][RsWin]::GetWindowThreadProcessId($h, [ref]$wp)
      if ($set.ContainsKey([uint32]$wp)) {
        # Chromium keeps hidden/utility windows around; a real app window has
        # this class and a non-empty title.
        $cls = New-Object Text.StringBuilder 128
        [void][RsWin]::GetClassNameW($h, $cls, 128)
        if ($cls.ToString() -eq 'Chrome_WidgetWin_1' -and [RsWin]::GetWindowTextLengthW($h) -gt 0) {
          [void]$found.Add($h)
        }
      }
    }
    return $true
  }
  [void][RsWin]::EnumWindows($cb, [IntPtr]::Zero)
  return @($found)
}

function Show-Window($h) {
  if ([RsWin]::IsIconic($h)) { [void][RsWin]::ShowWindow($h, $SW_RESTORE) }
  [void][RsWin]::SetForegroundWindow($h)
}

# ---- already open? -----------------------------------------------------
$existing = Get-AppWindows (Get-AppPids)

# RELOAD (measured, 2026-09-22)
#   A live page holds the modules it loaded at open time. After
#   `start.ps1 -Restart` the server serves the fixed code while the window that
#   is already open keeps running the old app.js / summary.js - the defect we
#   just fixed is still on screen and nothing warns about it. Twice the user had
#   to be told "press F5", which is not a fix, and the single-window rule means
#   closing and re-opening by hand does not help either: we bring the same
#   window back to the front.
#
#   So -Restart asks for -Reload: close the stale window, open a new one. The
#   page is a read-only view that re-reads everything within 3 seconds, so
#   nothing is lost. WM_CLOSE asks politely - it does not kill the process.
if ($existing.Count -ge 1 -and $Reload) {
  foreach ($h in $existing) {
    [void][RsWin]::PostMessage($h, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  foreach ($i in 1..40) {
    Start-Sleep -Milliseconds 250
    if ((Get-AppWindows (Get-AppPids)).Count -eq 0) { break }
  }
  $left = Get-AppWindows (Get-AppPids)
  if ($left.Count -gt 0) {
    # Do not stack a second window on top of a stale one - say so instead.
    Show-Window $left[0]
    Write-Host 'the old window did not close - press F5 in it to load the new code.' -ForegroundColor Yellow
    exit 0
  }
  Write-Host 'closed the old window (it was holding the code from before the restart).'
  $existing = @()
}

if ($existing.Count -ge 1) {
  Show-Window $existing[0]

  if ($existing.Count -gt 1 -and -not $KeepExtra) {
    # Duplicates from before this guard existed. They are identical read-only
    # views of the same page, so closing them loses nothing and re-opening is
    # one click. WM_CLOSE asks politely; it does not kill the process.
    foreach ($h in $existing[1..($existing.Count - 1)]) {
      [void][RsWin]::PostMessage($h, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    Write-Host ("closed {0} duplicate window(s)." -f ($existing.Count - 1)) -ForegroundColor Yellow
  }

  Write-Host 'status window was already open - brought it to the front.'
  exit 0
}

# ---- make sure the server is up (the UI task may still be starting) ----
# Liveness asks /api/ping, which computes nothing. /api/tray builds the whole
# status (11.7s cold, measured) and would time out on a healthy server.
if (-not $NoWait) {
  $ok = $false
  foreach ($i in 1..20) {
    try {
      $r = Invoke-WebRequest -Uri "$Url/api/ping" -TimeoutSec 5 -UseBasicParsing
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ok) {
    Write-Host "server is not answering at $Url - trying to start the UI task..." -ForegroundColor Yellow
    Start-ScheduledTask -TaskName 'EasyAI-RetrySession-UI' -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    try {
      $null = Invoke-WebRequest -Uri "$Url/api/ping" -TimeoutSec 5 -UseBasicParsing
    } catch {
      Write-Host 'still not answering. Start it by hand:' -ForegroundColor Red
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
  # tab rather than an app window, which is worse but still usable. Duplicate
  # suppression does not apply there - we cannot recognise the tab.
  Write-Host 'no Edge/Chrome found - opening in the default browser (tabbed).' -ForegroundColor Yellow
  Start-Process $Url
  exit 0
}

New-Item -ItemType Directory -Force -Path $UserDir | Out-Null

Start-Process -FilePath $browser -ArgumentList @(
  "--app=$Url",
  "--user-data-dir=$UserDir",
  '--window-size=1500,980',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter'
)

Write-Host "opened $Url as an app window."
