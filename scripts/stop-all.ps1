# stop-all.ps1 - stop EVERYTHING RetrySession runs. The complete off switch.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI - see CLAUDE.md).
#
# Called by stop.bat (a person), the tray menu "quit RetrySession", the status
# window's quit button (POST /api/shutdown) and start.ps1 -Stop. User request
# 2026-10-02: one action that leaves NOTHING RetrySession-related running - no
# process and no "service" that brings one back.
#
# What "everything" is, and why each step:
#   1. DISABLE every RetrySession scheduled task first. Ending processes alone is
#      not stopping: the monitor task starts a fresh process every 5 minutes and
#      the UI/tray tasks come back at the next logon. Disabled, not removed, so
#      the registration is kept - including an explicit -WithResume. start.bat
#      enables them again.
#   2. End the processes by EXACT identity, never by "the command line mentions
#      RetrySession": this folder is also open in VS Code and in Claude Code
#      sessions (claude.exe --add-dir ...\RetrySession) - that is the person's
#      work, not ours. Ours are:
#        - launcher wrappers: start.exe / runhidden.exe whose PATH is this folder
#        - node.exe running this folder's src\ui\server.mjs, src\hb.mjs,
#          src\heartbeat.mjs, src\rs.mjs or src\resume.mjs, plus whatever holds
#          the UI port - and every DESCENDANT of a resume run (the claude it
#          started is part of that run)
#        - powershell.exe running this folder's scripts\tray.ps1 / open-app.ps1
#        - the app window: a browser using OUR --user-data-dir
#      No Stop-ScheduledTask: ending a task may take its whole process tree, and
#      when the window's button asked, this script IS in the UI task's tree.
#   3. Our own ancestors go LAST. When the server (window button) or the tray
#      started this script, ending them first could take this script with them
#      before the rest is done. An ancestor that is only a LAUNCHER (start.exe
#      waiting on us - e.g. `start.exe -Stop` relaying this output to a
#      terminal) is not ended at all: cutting it breaks our own output pipe, and
#      it exits by itself the moment we do.
#   4. Verify and say so: nothing left, port free, tray mutex free, tasks
#      disabled. Exit 0 only when all of that is true - "asked to stop" is not
#      "stopped" (the lesson of this repo: registered is not serving).
#
#   -Port 7345      the UI port to check
#   -By stop.bat    who asked (written to state\stop.log)

param(
  [int]$Port = 7345,
  [string]$By = 'stop.bat'
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
$TaskNames = @(
  'EasyAI-RetrySession-Heartbeat',
  'EasyAI-RetrySession-Resume',
  'EasyAI-RetrySession-UI',
  'EasyAI-RetrySession-Tray'
)
$AppProfile = Join-Path $env:LOCALAPPDATA 'RetrySession\browser-profile'
$NodeScripts = @('src\ui\server.mjs', 'src\hb.mjs', 'src\heartbeat.mjs', 'src\rs.mjs', 'src\resume.mjs')
$PsScripts = @('scripts\tray.ps1', 'scripts\open-app.ps1')
$LogFile = Join-Path $Root 'state\stop.log'

function Write-Log([string]$text) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
    # two generations, like the other logs - an append-only file needs a ceiling
    if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt 256KB) {
      Move-Item -LiteralPath $LogFile -Destination ($LogFile + '.1') -Force
    }
    $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + " by=$By $text"
    [System.IO.File]::AppendAllText($LogFile, $line + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
  } catch { }
}

# ---- who is ours --------------------------------------------------------
# Returns @{ pid = reason }. Pure lookups over one process snapshot.
function Get-Ours {
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $rootLc = $Root.ToLowerInvariant()
  $profLc = $AppProfile.ToLowerInvariant()
  $found = @{}
  # Keys are always [int]: CIM gives UInt32, the port lookup gives Int32, and a
  # hashtable treats 1234 and [uint32]1234 as DIFFERENT keys - one process would
  # be counted twice as "left".
  foreach ($p in $all) {
    $id = [int]$p.ProcessId
    if ($id -eq $PID) { continue }
    $name = ([string]$p.Name).ToLowerInvariant()
    $exe = ([string]$p.ExecutablePath).ToLowerInvariant()
    $cmd = ([string]$p.CommandLine).ToLowerInvariant()
    if (($name -eq 'start.exe' -or $name -eq 'runhidden.exe') -and $exe.StartsWith($rootLc + '\')) {
      $found[$id] = "launcher $name"; continue
    }
    if ($name -eq 'node.exe') {
      foreach ($s in $NodeScripts) {
        if ($cmd.Contains((Join-Path $Root $s).ToLowerInvariant())) { $found[$id] = "node $s"; break }
      }
      continue
    }
    if ($name -eq 'powershell.exe' -or $name -eq 'pwsh.exe') {
      foreach ($s in $PsScripts) {
        if ($cmd.Contains((Join-Path $Root $s).ToLowerInvariant())) { $found[$id] = "powershell $s"; break }
      }
      continue
    }
    if (($name -eq 'msedge.exe' -or $name -eq 'chrome.exe') -and $cmd.Contains($profLc)) {
      $found[$id] = 'app window'
    }
  }
  # whatever holds the UI port is ours too (a server started by a relative path)
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      ForEach-Object { $o = [int]$_.OwningProcess; if ($o -and $o -ne $PID -and -not $found.ContainsKey($o)) { $found[$o] = "port $Port" } }
  } catch { }
  # a resume run is a tree: the claude it started belongs to it
  $kids = @{}
  foreach ($p in $all) {
    $pp = [int]$p.ParentProcessId
    if (-not $kids.ContainsKey($pp)) { $kids[$pp] = @() }
    $kids[$pp] += $p
  }
  $queue = New-Object System.Collections.Queue
  foreach ($k in @($found.Keys)) { if ($found[$k] -like 'node src\r*') { $queue.Enqueue([int]$k) } }
  while ($queue.Count -gt 0) {
    $cur = [int]$queue.Dequeue()
    if (-not $kids.ContainsKey($cur)) { continue }
    foreach ($c in $kids[$cur]) {
      $cid = [int]$c.ProcessId
      if ($cid -ne $PID -and -not $found.ContainsKey($cid)) {
        $found[$cid] = "child of a resume run ($($c.Name))"
        $queue.Enqueue($cid)
      }
    }
  }
  return $found
}

# One snapshot, walked in memory - a filtered CIM query per level costs ~0.2 s each.
function Get-Ancestors {
  $parent = @{}
  foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) { $parent[[int]$p.ProcessId] = [int]$p.ParentProcessId }
  $set = @{}
  $cur = [int]$PID
  for ($i = 0; $i -lt 32; $i++) {
    if (-not $parent.ContainsKey($cur)) { break }
    $up = $parent[$cur]
    if (-not $up -or $set.ContainsKey($up)) { break }
    $set[$up] = $true
    $cur = $up
  }
  return $set
}

# Measured 2026-10-02: one Get-ScheduledTask costs ~1.5 s here. Asking per name
# (and again to verify) made a stop take 16-18 s. Ask once, with the wildcard.
function Get-OurTasks {
  @(Get-ScheduledTask -TaskName 'EasyAI-RetrySession-*' -ErrorAction SilentlyContinue |
    Where-Object { $TaskNames -contains $_.TaskName })
}

function Stop-Ours($ids, $why) {
  foreach ($id in $ids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if (-not $p) { continue }
    # the app window first gets a polite close (no "restore pages" next time)
    if ($why[$id] -eq 'app window' -and $p.MainWindowHandle -ne 0) {
      $null = $p.CloseMainWindow(); Start-Sleep -Milliseconds 300
      if ($p.HasExited) { Write-Host ("closed   : pid {0,-6} {1}" -f $id, $why[$id]); continue }
    }
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    Write-Host ("stopped  : pid {0,-6} {1}" -f $id, $why[$id])
  }
}

Write-Host ''
Write-Host '== RetrySession - stopping everything ==' -ForegroundColor Cyan
Write-Log 'stop requested'

# ---- 1. tasks: disable so nothing comes back on its own -----------------
$tasks = Get-OurTasks
foreach ($n in $TaskNames) {
  $t = $tasks | Where-Object { $_.TaskName -eq $n }
  if (-not $t) { Write-Host "task     : $n (not registered)"; continue }
  if ($t.State -ne 'Disabled') { $t | Disable-ScheduledTask -ErrorAction SilentlyContinue | Out-Null }
  Write-Host "task     : $n disabled"
}

# ---- 2. processes: everyone but our own ancestors -----------------------
$anc = Get-Ancestors
for ($round = 1; $round -le 3; $round++) {
  $ours = Get-Ours
  $now = @($ours.Keys | Where-Object { -not $anc.ContainsKey([int]$_) })
  if ($now.Count -eq 0) { break }
  Stop-Ours $now $ours
  Start-Sleep -Milliseconds 700    # a wrapper exits when its child dies; look again
}

# ---- 3. our own ancestors last (the server or tray that started us) -----
# Launchers among them are left alone: they wait on us and exit with us.
$ours = Get-Ours
$waiting = @{}
foreach ($k in @($ours.Keys)) { if ($anc.ContainsKey([int]$k) -and $ours[$k] -like 'launcher*') { $waiting[[int]$k] = $true } }
$last = @($ours.Keys | Where-Object { $anc.ContainsKey([int]$_) -and -not $waiting.ContainsKey([int]$_) })
if ($last.Count -gt 0) {
  Write-Log ('ending own ancestors last: ' + (($last | ForEach-Object { "$_ $($ours[$_])" }) -join ', '))
  Stop-Ours $last $ours
  Start-Sleep -Milliseconds 700
}

# ---- 4. verify ----------------------------------------------------------
$left = Get-Ours
foreach ($k in @($left.Keys)) {
  if ($waiting.ContainsKey([int]$k)) {
    Write-Host ("waiting  : pid {0,-6} {1} - it started this script and exits with it" -f $k, $left[$k]) -ForegroundColor DarkGray
    $left.Remove($k)
  }
}
$portBusy = $false
try { $portBusy = [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) } catch { }
$m = $null
$trayUp = $false
try { $trayUp = [System.Threading.Mutex]::TryOpenExisting('Global\EasyAI-RetrySession-Tray', [ref]$m) } catch { }
if ($m) { $m.Dispose() }
$enabled = @(Get-OurTasks | Where-Object { $_.State -ne 'Disabled' } | ForEach-Object TaskName)

Write-Host ''
Write-Host '== check ==' -ForegroundColor Cyan
Write-Host ("processes left : {0}" -f $left.Count)
foreach ($k in $left.Keys) { Write-Host ("  pid {0,-6} {1}" -f $k, $left[$k]) -ForegroundColor Red }
Write-Host ("port $Port      : " + $(if ($portBusy) { 'STILL LISTENING' } else { 'free' }))
Write-Host ("tray           : " + $(if ($trayUp) { 'STILL RUNNING' } else { 'not running' }))
Write-Host ("tasks enabled  : " + $(if ($enabled.Count) { $enabled -join ', ' } else { 'none' }))

$ok = ($left.Count -eq 0) -and (-not $portBusy) -and (-not $trayUp) -and ($enabled.Count -eq 0)
Write-Host ''
if ($ok) {
  Write-Log 'stopped: nothing left'
  Write-Host 'stopped - nothing of RetrySession is running, and nothing will start on its own.' -ForegroundColor Green
  Write-Host '  start again with: start.bat'
  exit 0
}
Write-Log ("NOT fully stopped: left=$($left.Count) port=$portBusy tray=$trayUp enabled=" + ($enabled -join ','))
Write-Host 'NOT fully stopped - see the lines above.' -ForegroundColor Red
exit 1
