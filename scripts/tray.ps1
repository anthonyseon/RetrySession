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
$script:lastKind = $null

function Poll {
  $kind = 'off'; $head = ''; $tip = ''

  try {
    $s = Invoke-RestMethod -Uri "$BaseUrl/api/tray" -TimeoutSec 8

    # The server decided `state`; the tray must not re-derive it, or the tray
    # and the window would disagree about what is wrong.
    switch ($s.state) {
      'stalled' { $kind = 'crit'; $head = (Lbl 'status.stalled' 'monitor stalled') + " ($($s.dead))" }
      'blocked' { $kind = 'crit'; $head = (Lbl 'status.blocked' 'resume blocked') + " ($($s.blocked))" }
      'limited' { $kind = 'warn'; $head = Lbl 'status.limited' 'usage limited' }
      'none'    { $kind = 'off';  $head = Lbl 'status.none' 'nothing watched' }
      default   { $kind = 'good'; $head = (Lbl 'status.ok' 'monitor ok') + " ($($s.watched))" }
    }

    # Unread alert count belongs in the tooltip, not in a popup.
    if ($s.alerts -and $s.alerts -gt 0) { $head = "$head - " + (Lbl 'status.alerts' 'alerts') + " $($s.alerts)" }

    $tip = "$AppName - $head`n" +
           (Lbl 'tip.sessions' 'sessions') + " $($s.running)/$($s.sessions)  " +
           (Lbl 'tip.watch' 'watch') + " $($s.watched)  " +
           (Lbl 'tip.resume' 'resume') + " $($s.resumeOn)"
  } catch {
    $kind = 'crit'; $head = Lbl 'status.down' 'status server down'
    $tip = "$AppName - $head"
  }

  $icon.Icon = Get-StatusIcon $kind
  # NotifyIcon.Text is capped at 63 characters; a longer string throws.
  if ($tip.Length -gt 62) { $tip = $tip.Substring(0, 62) }
  $icon.Text = $tip
  $hdr.Text  = $head
  $script:lastKind = $kind
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(2, $IntervalSeconds) * 1000
$timer.Add_Tick({ Poll })
$timer.Start()

Poll   # first reading right away instead of after one interval

$ctx = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($ctx)

$timer.Stop()
$icon.Dispose()
[System.GC]::KeepAlive($global:RSTrayMutex)
$global:RSTrayMutex.ReleaseMutex()
