# tray.ps1 - tray icon: watch status at a glance, open the window, get notified.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#   Korean wording lives in config/ui-labels.json and is read as UTF-8 at
#   runtime. That file's KEYS are ASCII on purpose, because this script names
#   them in code. Never type Korean into this file.
#   For the same reason this script reads /api/tray, not /api/status: the status
#   payload has Korean property names, which this script could not reference.
#
# Why PowerShell + WinForms and not Electron
#   Zero install. This tool has to come up when everything else is broken, so a
#   tray that needs `npm install` first is a tray that is missing when needed.
#
# The icon is DRAWN at runtime (a filled circle in the status color), so there is
# no .ico asset to keep in sync. Status is never carried by color alone - the
# tooltip and the menu header always spell it out in words.
#
# No cmd.exe: every child process is started with Start-Process on an executable.

param(
  [int]$Port = 7345,
  [int]$IntervalSeconds = 5
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

# ---- win32: let an outside click dismiss the menu ------------------------
# A NotifyIcon menu belongs to a process that is not the foreground window, so
# Windows does not always send it the "you lost focus" message - the menu can
# sit there after the user clicks elsewhere. Making our menu the foreground
# window first is the documented fix (KB135788).
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class RsTrayWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
'@

$Root    = Split-Path -Parent $PSScriptRoot
$BaseUrl = "http://127.0.0.1:$Port"

# ---- single instance ----------------------------------------------------
# Held in a GLOBAL so nothing collects it. A Mutex released by the finalizer
# would silently let a second tray start, and two icons reporting the same
# thing is worse than one.
$global:RSTrayMutex = New-Object System.Threading.Mutex($false, 'Global\EasyAI-RetrySession-Tray')
if (-not $global:RSTrayMutex.WaitOne(0)) { exit 0 }   # already running

# ---- labels (UTF-8 values, ASCII keys) ----------------------------------
$L = $null
try {
  $L = [System.IO.File]::ReadAllText(
        (Join-Path $Root 'config\ui-labels.json'), [System.Text.Encoding]::UTF8
       ) | ConvertFrom-Json
} catch { $L = $null }

# A missing label file must not stop the tray - a watchdog that refuses to start
# tells you nothing, which is exactly the failure this tool exists to prevent.
function Lbl([string]$path, [string]$fallback) {
  if (-not $L) { return $fallback }
  try {
    $cur = $L
    foreach ($part in $path.Split('.')) { $cur = $cur.$part }
    if ($cur) { return [string]$cur }
  } catch { }
  return $fallback
}

$AppName = Lbl 'app' 'RetrySession'

# ---- icon drawing -------------------------------------------------------
# Status palette - the same hexes the web UI uses.
$Colors = @{
  good = [System.Drawing.ColorTranslator]::FromHtml('#0CA30C')
  warn = [System.Drawing.ColorTranslator]::FromHtml('#FAB219')
  crit = [System.Drawing.ColorTranslator]::FromHtml('#D03B3B')
  off  = [System.Drawing.ColorTranslator]::FromHtml('#898781')
}
$script:iconCache = @{}
function Get-StatusIcon([string]$kind) {
  if ($script:iconCache.ContainsKey($kind)) { return $script:iconCache[$kind] }
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush $Colors[$kind]
  $g.FillEllipse($brush, 2, 2, 12, 12)
  # a soft dark ring keeps the dot visible on both light and dark taskbars
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 0, 0, 0)), 1
  $g.DrawEllipse($pen, 2, 2, 12, 12)
  $brush.Dispose(); $pen.Dispose(); $g.Dispose()
  $ico = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $script:iconCache[$kind] = $ico
  return $ico
}

# ---- helpers ------------------------------------------------------------
$psExe = (Get-Process -Id $PID).Path   # the powershell.exe running this script

function Open-Window {
  Start-Process -FilePath $psExe -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', (Join-Path $Root 'scripts\open-app.ps1'), '-NoWait'
  )
}

# ---- tray icon and menu -------------------------------------------------
$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = Get-StatusIcon 'off'
$icon.Text = "$AppName - ..."
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

# header row: the current state in words (never color alone)
$hdr = New-Object System.Windows.Forms.ToolStripMenuItem
$hdr.Enabled = $false
$menu.Items.Add($hdr) | Out-Null
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

function Add-Item([string]$text, [scriptblock]$action) {
  $i = New-Object System.Windows.Forms.ToolStripMenuItem
  $i.Text = $text
  $i.Add_Click($action)
  $menu.Items.Add($i) | Out-Null
}

Add-Item (Lbl 'menu.open' 'Open window') { Open-Window }

Add-Item (Lbl 'menu.runMonitor' 'Run monitor now') {
  try {
    Invoke-RestMethod -Uri "$BaseUrl/api/run" -Method Post -Body '{"kind":"heartbeat"}' `
      -ContentType 'application/json' -TimeoutSec 10 | Out-Null
  } catch {
    # server down - go straight to the OS task instead
    Start-ScheduledTask -TaskName 'EasyAI-RetrySession-Heartbeat' -ErrorAction SilentlyContinue
  }
}

Add-Item (Lbl 'menu.tasks' 'Scheduled task status') { Start-Process -FilePath 'taskschd.msc' }

$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

Add-Item (Lbl 'menu.quit' 'Quit tray') {
  $icon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
}

$icon.ContextMenuStrip = $menu
$icon.Add_MouseDoubleClick({ Open-Window })

# ---- menu dismissal -----------------------------------------------------
#
# Two ways out of the menu, because a tray menu that will not go away is worse
# than no menu - it sits on top of whatever the user is doing.
#
# 1. CLICK ELSEWHERE.
#    AutoClose does this, but only if the menu is told it lost focus. A tray
#    menu belongs to a process that is not in the foreground, so Windows may
#    never send that message and the menu stays put. Making the menu the
#    foreground window when it opens is the documented fix (KB135788).
#
# 2. WALK AWAY.
#    If the user opens the menu and does nothing, it closes on its own.
#    Hovering it counts as doing something, so it will not vanish while being
#    read. Only idle time closes it.
$MenuIdleSeconds = 8
$script:menuIdleFrom = $null

$menu.AutoClose = $true
$menu.Add_Opened({
  [RsTrayWin]::SetForegroundWindow($menu.Handle) | Out-Null
  $script:menuIdleFrom = [DateTime]::UtcNow
})
$menu.Add_Closed({ $script:menuIdleFrom = $null })
# Any pointer movement over the menu means the user is still with it.
$menu.Add_MouseMove({ $script:menuIdleFrom = [DateTime]::UtcNow })
$menu.Add_ItemClicked({ $script:menuIdleFrom = [DateTime]::UtcNow })

# A short timer, and only while the menu is open. Checking idle time on the
# 5-second status tick would make "8 seconds" mean anywhere from 8 to 13.
$menuTimer = New-Object System.Windows.Forms.Timer
$menuTimer.Interval = 500
$menuTimer.Add_Tick({
  if ($null -eq $script:menuIdleFrom) { return }
  if (([DateTime]::UtcNow - $script:menuIdleFrom).TotalSeconds -ge $MenuIdleSeconds) {
    $script:menuIdleFrom = $null
    $menu.Close()
  }
})
$menuTimer.Start()

# ---- polling ------------------------------------------------------------
#
# IMPORTANT: NO BALLOON NOTIFICATIONS.
#
#   An earlier version raised a Windows balloon on every state change. In
#   practice it fired far too often - a single server restart flips the state
#   twice - and constant popups are how a real warning gets ignored. Worse, a
#   balloon interrupts whatever the user is doing to say something they cannot
#   act on from the popup anyway.
#
#   The tray now carries STATE ONLY: a coloured dot, a tooltip, and the menu
#   header, all in words as well as colour. Alerts and their history live in
#   the window (its alerts tab), which is where you can actually act on them.
#   Do not add ShowBalloonTip back here.
#
# *** THE UI THREAD IS NEVER BLOCKED. *** (measured bug, 2026-09-21)
#
#   This used to call `Invoke-RestMethod` straight from the timer tick. A
#   WinForms timer ticks ON THE UI THREAD, so for as long as that request was in
#   flight the thread could not pump messages - and an open context menu is
#   drawn by that same thread. Result: right-click the tray icon, and within 5
#   seconds the menu froze mid-display.
#
#   It was not a rare hazard. /api/tray builds the whole status: measured
#   0.65s, 0.70s and 1.86s warm on this machine, and 11.3s on a cold cache.
#   The menu was therefore frozen for a large part of the time it was open,
#   which is exactly what the user reported.
#
#   So the request is started and then only CHECKED for completion on later
#   ticks. Each tick does a handful of microseconds of work, whatever the
#   server is doing. HttpClient is in-box (.NET Framework) - no new dependency.
$script:lastKind = $null
$script:http = New-Object System.Net.Http.HttpClient
$script:http.Timeout = [TimeSpan]::FromSeconds(20)
$script:task = $null      # the request in flight
$script:taskKind = $null  # 'tray' or 'ping'

function Start-Request([string]$path, [string]$kind) {
  try {
    $script:taskKind = $kind
    $script:task = $script:http.GetStringAsync("$BaseUrl$path")
  } catch {
    # Could not even start the request. Leave nothing in flight so the next
    # tick tries again - a tray that stops asking is a tray that lies.
    $script:task = $null
    $script:taskKind = $null
  }
}

function Render([string]$kind, [string]$head, [string]$tip) {
  $icon.Icon = Get-StatusIcon $kind
  # NotifyIcon.Text is capped at 63 characters; a longer string throws.
  if ($tip.Length -gt 62) { $tip = $tip.Substring(0, 62) }
  $icon.Text = $tip
  $hdr.Text  = $head
  $script:lastKind = $kind
}

function Show-TrayState([string]$body) {
  $kind = 'off'; $head = ''; $tip = ''
  try {
    $s = $body | ConvertFrom-Json

    # The server decided `state`; the tray must not re-derive it, or the tray
    # and the window would disagree about what is wrong.
    switch ($s.state) {
      'stalled' { $kind = 'crit'; $head = (Lbl 'status.stalled' 'monitor stalled') + " ($($s.dead))" }
      # Cannot tell whether sessions are running - autonomous resume is
      # fail-closed, so it has stopped. Quiet-looking, but nothing is working.
      'unknown' { $kind = 'crit'; $head = Lbl 'status.unknown' 'run state unknown' }
      'blocked' { $kind = 'crit'; $head = (Lbl 'status.blocked' 'resume blocked') + " ($($s.blocked))" }
      'limited' { $kind = 'warn'; $head = Lbl 'status.limited' 'usage limited' }
      'none'    { $kind = 'off';  $head = Lbl 'status.none' 'nothing watched' }
      default   { $kind = 'good'; $head = (Lbl 'status.ok' 'monitor ok') + " ($($s.watched))" }
    }

    # Unread alert count belongs in the tooltip, not in a popup.
    if ($s.alerts -and $s.alerts -gt 0) { $head = "$head - " + (Lbl 'status.alerts' 'alerts') + " $($s.alerts)" }

    # "0 running" and "cannot tell" are not the same claim - do not print 0.
    $runTxt = if ($s.runningKnown -eq $false) { '?' } else { "$($s.running)" }
    $tip = "$AppName - $head`n" +
           (Lbl 'tip.sessions' 'sessions') + " $runTxt/$($s.sessions)  " +
           (Lbl 'tip.watch' 'watch') + " $($s.watched)  " +
           (Lbl 'tip.resume' 'resume') + " $($s.resumeOn)"
  } catch {
    # The body was not the shape we expect - ask the cheap endpoint what is
    # really going on rather than guessing (see Resolve-Failure).
    Start-Request '/api/ping' 'ping'
    return
  }

  Render $kind $head $tip
}

# Slow is not dead.
#
# Measured: a cold /api/tray took 11.3 seconds. Treating that timeout as "server
# down" would paint the tray red while the server is fine - the same cry-wolf
# failure this tool exists to avoid. So a failed /api/tray does not decide
# anything; it starts a /api/ping, and the ANSWER to that decides.
function Resolve-Failure {
  if ($script:taskKind -eq 'tray') {
    Start-Request '/api/ping' 'ping'   # still asynchronous - no blocking
    return
  }
  # ping failed too: nothing is listening.
  Render 'crit' (Lbl 'status.down' 'status server down') ("$AppName - " + (Lbl 'status.down' 'status server down'))
}

function Resolve-Ping {
  # The server answers, so it is alive and merely slow. Keep the last known
  # state instead of inventing a worse one.
  $kind = if ($script:lastKind) { $script:lastKind } else { 'off' }
  $head = Lbl 'status.slow' 'status slow'
  Render $kind $head "$AppName - $head"
}

# The timer tick. Must stay cheap - see the block comment above.
#
# Everything is wrapped: an error escaping a WinForms event handler can take the
# whole tray down, and a watchdog that quietly disappears is the worst outcome
# this repo has - the icon would simply stop being there and nobody is told.
function Poll {
  try {
    # A request is in flight: look, do not wait.
    if ($null -ne $script:task) {
      if (-not $script:task.IsCompleted) { return }   # <- this is what keeps the menu alive

      $t = $script:task
      $kindWas = $script:taskKind
      $script:task = $null
      $script:taskKind = $null

      if ($t.IsFaulted -or $t.IsCanceled) {
        $script:taskKind = $kindWas
        Resolve-Failure
      } elseif ($kindWas -eq 'ping') {
        Resolve-Ping
      } else {
        Show-TrayState $t.Result
      }
      return
    }

    Start-Request '/api/tray' 'tray'
  } catch {
    $script:task = $null
    $script:taskKind = $null
  }
}

$timer = New-Object System.Windows.Forms.Timer
# Halved: a tick is now microseconds, and completed requests are noticed sooner.
$timer.Interval = [Math]::Max(1, [int]([Math]::Max(2, $IntervalSeconds) / 2)) * 1000
$timer.Add_Tick({ Poll })
$timer.Start()

Poll   # start the first request right away instead of after one interval

$ctx = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($ctx)

$timer.Stop()
$menuTimer.Stop()
$script:http.Dispose()
$icon.Dispose()
[System.GC]::KeepAlive($global:RSTrayMutex)
$global:RSTrayMutex.ReleaseMutex()
