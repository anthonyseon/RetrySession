# start.ps1 - what start.bat runs. Opens RetrySession and makes sure it is up.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI - see CLAUDE.md).
# No cmd.exe beyond start.bat / stop.bat themselves: executables are launched
# directly, hidden (start.exe --hidden).
#
# A person uses start.bat (run) and stop.bat (stop everything) - user request
# 2026-10-02. Every switch below can be passed through start.bat as well.
#
#   .\start.ps1                  bring everything up and open the window
#                                (builds start.exe, re-enables tasks a stop disabled,
#                                registers monitor/UI/tray if missing)
#   .\start.ps1 -Install         register the OS tasks + shortcuts again
#   .\start.ps1 -Install -WithResume   ... including the unattended resumer
#   .\start.ps1 -Restart         pick up code changes (see below)
#   .\start.ps1 -Status          just print status, open nothing
#   .\start.ps1 -Stop            stop EVERYTHING (= stop.bat): tasks disabled, every process ended
#   .\start.ps1 -Uninstall       stop everything and remove every OS task
#   .\start.ps1 -Pc              check the PC power settings this tool needs
#   .\start.ps1 -Pc -Apply       and set them (reversible: -Pc -Restore)
#
# -Restart exists because of a measured trap: a plain start finds the server
# "already up" and leaves it alone, but a live node process keeps the modules it
# loaded at startup. So after editing anything under src\, the window keeps
# showing the OLD behaviour and nothing warns you. -Restart frees the port and
# starts clean.
#
# It re-opens the status window too. The page holds the modules it loaded when
# it opened, so restarting only the server leaves the old code on screen -
# measured twice, and both times the user had to be told to press F5.
#
# Plain `.\start.ps1` is safe and spends nothing: the monitor and the UI only
# read and record. The resumer is the only part that spends tokens, and it is
# never registered unless you pass -WithResume.

param(
  [switch]$Install,
  [switch]$WithResume,
  [switch]$Restart,
  [switch]$Status,
  [switch]$Stop,
  [switch]$Uninstall,
  [switch]$NoWindow,
  # PC power settings - they decide whether any of this can run at all.
  #   -Pc            check only (changes nothing)
  #   -Pc -Apply     set the recommended values (the old ones are saved)
  #   -Pc -Restore   put back what -Apply changed
  [switch]$Pc,
  [switch]$Apply,
  [switch]$Restore,
  [int]$Port = 7345
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Scripts = Join-Path $Root 'scripts'
# start.exe --hidden starts a child with CREATE_NO_WINDOW (tools/Launcher.cs).
# Used wherever we start a console program, because `-WindowStyle Hidden` does
# not prevent a window when Windows Terminal is the default console host.
# $null when start.exe is missing or an old build without --hidden.
. (Join-Path $Scripts 'launcher-lib.ps1')
$Hidden = Get-HiddenLauncher $Root

function Head($text) {
  Write-Host ''
  Write-Host "== $text ==" -ForegroundColor Cyan
}

function Get-Node {
  $n = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $n) {
    Write-Host 'node was not found on PATH.' -ForegroundColor Red
    Write-Host '  install Node.js 20+ and run this again.'
    exit 1
  }
  return $n
}

# Timeout is 10s, not 5s. A DEAD server is refused immediately (connection
# refused) - it does not time out. A timeout only means BUSY: /api/status does
# synchronous work (CLI + scheduler queries) and blocks the single node thread,
# so /api/ping was measured at up to 3.7s even after the async fix (7.9s before).
# Calling a busy-but-alive server "not answering" is the exact mistake that once
# left the tray unstarted. Slow is not dead.
# Liveness goes to /api/ping, which computes nothing.
#
# MEASURED BUG (2026-09-22): this asked /api/tray with a 3 second timeout.
# That endpoint builds the whole status - measured 11.7s on a cold cache - so a
# perfectly healthy server was reported as "not answering on port 7345", and
# because that path calls `exit 1`, the TRAY WAS NEVER STARTED either. One false
# reading took down a part that was fine.
#
# status.ps1 already learned this and uses /api/ping. This copy was missed.
# Liveness must never ride on the heavy aggregation - that is the whole lesson.
function Test-Server {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/ping" -TimeoutSec 10 -UseBasicParsing
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

function Get-TrayRunning {
  # Liveness by mutex, not by command-line matching: any process whose command
  # line merely mentions tray.ps1 (a diagnostic query) would look like the tray.
  $m = New-Object System.Threading.Mutex($false, 'Global\EasyAI-RetrySession-Tray')
  $free = $m.WaitOne(0)
  if ($free) { $m.ReleaseMutex() }
  $m.Dispose()
  return (-not $free)
}

# ---------------------------------------------------------------- uninstall
if ($Uninstall) {
  Head 'removing OS tasks and stopping everything'
  & (Join-Path $Scripts 'unregister-all.ps1')
  Write-Host ''
  Write-Host 'state\ was kept (targets, logs, history). Re-run -Install to come back.'
  exit 0
}

# --------------------------------------------------------------------- stop
# The same complete stop as stop.bat, the tray's "quit" and the window's quit
# button - one script, so the four never disagree about what "stopped" means.
if ($Stop) {
  & (Join-Path $Scripts 'stop-all.ps1') -Port $Port -By 'start.ps1'
  exit $LASTEXITCODE
}

$node = Get-Node

# ------------------------------------------------------------------ install
if ($Install) {
  Head 'checking the code before registering anything'
  & $node --test (Join-Path $Root 'test\ascii.test.mjs') | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'the ASCII guard test failed - a .ps1 has non-ASCII bytes.' -ForegroundColor Red
    Write-Host '  PowerShell 5.1 would fail to parse it. Fix that before registering.'
    exit 1
  }
  Write-Host 'ASCII guard passed.' -ForegroundColor Green

  Head 'registering OS tasks'
  if ($WithResume) {
    & (Join-Path $Scripts 'register-all.ps1') -WithResume
  } else {
    & (Join-Path $Scripts 'register-all.ps1')
  }
  if (-not $NoWindow) { & (Join-Path $Scripts 'open-app.ps1') -Port $Port }
  exit 0
}

# ----------------------------------------------------------------- pc setup
#
# A sleeping PC runs nothing. Everything here is an OS scheduled task, so if
# the machine sleeps the 5 minute monitor simply stops - and that gap looks
# exactly like the 9 hour outage this tool was built after.
#
# Checking changes nothing. Applying is explicit, and the previous values are
# saved so -Pc -Restore puts them back.
if ($Pc) {
  $pcArgs = @((Join-Path $Root 'src\pc.mjs'))
  if ($Apply)   { $pcArgs += "--apply" }
  if ($Restore) { $pcArgs += "--restore" }
  & $node @pcArgs
  exit $LASTEXITCODE
}

# ------------------------------------------------------------------- status
if ($Status) {
  & (Join-Path $Scripts 'status.ps1')
  exit $LASTEXITCODE
}

# ------------------------------------------------------------------ restart
if ($Restart) {
  Head 'restarting server and tray to pick up code changes'

  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        Write-Host "  stopping server pid $_" -ForegroundColor Yellow
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
  } catch { }

  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*-File*\tray.ps1*' } |
    ForEach-Object {
      Write-Host "  stopping tray pid $($_.ProcessId)" -ForegroundColor Yellow
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  Start-Sleep -Seconds 2
  # fall through to the normal start below, which now finds nothing running
}

# -------------------------------------------------------------- normal start
Head 'RetrySession'

# 0. the parts a stop took away, and the parts a fresh clone never had.
#    - start.exe is a build artifact (not in git): build it when missing, or
#      when it is an old build without --hidden (the tasks depend on it).
#    - a stop (stop.bat / tray / window) DISABLES the tasks so nothing comes back
#      on its own. Starting is the other half: enable them again. A registered
#      resumer is enabled too - that restores an explicit -WithResume choice.
#    - missing monitor/UI/tray tasks are registered. Never the resumer: it spends
#      tokens unattended and needs -Install -WithResume, typed on purpose.
if (-not $Hidden) {
  Write-Host "launcher : start.exe is missing or too old (no $HiddenSwitch) - building it" -ForegroundColor Yellow
  try { & (Join-Path $Scripts 'build-exe.ps1') | Out-Host } catch { Write-Host "  build failed: $($_.Exception.Message)" -ForegroundColor Red }
  $Hidden = Get-HiddenLauncher $Root
}
$ours = @(Get-ScheduledTask -TaskName 'EasyAI-RetrySession-*' -ErrorAction SilentlyContinue)
$wasOff = @($ours | Where-Object { $_.State -eq 'Disabled' })
foreach ($t in $wasOff) {
  Enable-ScheduledTask -TaskName $t.TaskName -ErrorAction SilentlyContinue | Out-Null
  Write-Host "task     : enabled $($t.TaskName)" -ForegroundColor Green
}
$absent = @('EasyAI-RetrySession-Heartbeat', 'EasyAI-RetrySession-UI', 'EasyAI-RetrySession-Tray' |
  Where-Object { $_ -notin @($ours | ForEach-Object TaskName) })
if ($absent.Count -gt 0) {
  Write-Host "task     : not registered ($($absent -join ', ')) - registering (never the resumer)" -ForegroundColor Yellow
  try { & (Join-Path $Scripts 'register-all.ps1') | Out-Host } catch { Write-Host "  registering failed: $($_.Exception.Message)" -ForegroundColor Red }
} elseif ($wasOff.Count -gt 0) {
  # record right away - otherwise the window says "monitor stalled" until the next 5-minute tick
  Start-ScheduledTask -TaskName 'EasyAI-RetrySession-Heartbeat' -ErrorAction SilentlyContinue
}

# 1. server
if (Test-Server) {
  Write-Host 'server   : already up' -ForegroundColor Green
  Write-Host '           (code changes are NOT picked up - use -Restart)' -ForegroundColor DarkGray
} else {
  $task = Get-ScheduledTask -TaskName 'EasyAI-RetrySession-UI' -ErrorAction SilentlyContinue
  if ($task) {
    Write-Host 'server   : starting the registered task...'
    Start-ScheduledTask -TaskName 'EasyAI-RetrySession-UI'
  } else {
    # Not registered yet - run it directly so the user still gets a window.
    #
    # Go through start.exe --hidden. `-WindowStyle Hidden` is not enough: the
    # console is allocated before the child runs, and on Windows 11 the default
    # console host is Windows Terminal, whose window that flag does not control
    # (measured - that is how the tray task ended up showing one all day).
    Write-Host 'server   : task not registered - starting it directly for now'
    $serverArgs = @("`"$(Join-Path $Root 'src\ui\server.mjs')`"", '--port', $Port)
    if ($Hidden) {
      Start-Process -FilePath $Hidden -WorkingDirectory $Root `
        -ArgumentList (@($HiddenSwitch, "`"$node`"") + $serverArgs)
    } else {
      Start-Process -FilePath $node -WindowStyle Hidden `
        -ArgumentList $serverArgs -WorkingDirectory $Root
    }
  }

  $up = $false
  foreach ($i in 1..20) { Start-Sleep -Milliseconds 600; if (Test-Server) { $up = $true; break } }
  if ($up) {
    Write-Host 'server   : up' -ForegroundColor Green
  } else {
    Write-Host "server   : not answering on port $Port" -ForegroundColor Red
    Write-Host "  see the error by running it in the foreground:"
    Write-Host "  node `"$(Join-Path $Root 'src\ui\server.mjs')`""
    exit 1
  }
}

# 2. tray
if (Get-TrayRunning) {
  Write-Host 'tray     : already running' -ForegroundColor Green
} else {
  # Prefer the registered task. Starting the tray directly works, but then the
  # task keeps its last (stopped) result and the status screen shows the tray
  # task as failed while a tray is plainly running - two sources disagreeing.
  $trayTask = Get-ScheduledTask -TaskName 'EasyAI-RetrySession-Tray' -ErrorAction SilentlyContinue
  if ($trayTask) {
    Write-Host 'tray     : starting the registered task...'
    Start-ScheduledTask -TaskName 'EasyAI-RetrySession-Tray'
  } else {
    # Same reason as the server above - no console at all, not a hidden one.
    $psExe = (Get-Process -Id $PID).Path
    if ($Hidden) {
      Start-Process -FilePath $Hidden -WorkingDirectory $Root -ArgumentList @(
        $HiddenSwitch, $psExe, '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', (Join-Path $Scripts 'tray.ps1'), '-Port', $Port
      )
    } else {
      Start-Process -FilePath $psExe -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', (Join-Path $Scripts 'tray.ps1'), '-Port', $Port
      )
    }
  }
  Start-Sleep -Seconds 3
  if (Get-TrayRunning) { Write-Host 'tray     : started' -ForegroundColor Green }
  else { Write-Host 'tray     : did not start (the window still works)' -ForegroundColor Yellow }
}

# 3. what the monitor currently thinks - the number that actually matters
Head 'record freshness (fail-closed: unknown counts as dead)'
& $node (Join-Path $Root 'src\heartbeat.mjs') --check
$fresh = $LASTEXITCODE

# 4. warn if the OS tasks are missing, since then nothing survives this session
$missing = @()
foreach ($n in 'EasyAI-RetrySession-Heartbeat', 'EasyAI-RetrySession-UI', 'EasyAI-RetrySession-Tray') {
  if (-not (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue)) { $missing += $n }
}
if ($missing.Count -gt 0) {
  Write-Host ''
  Write-Host 'these OS tasks are NOT registered:' -ForegroundColor Yellow
  $missing | ForEach-Object { Write-Host "  - $_" }
  Write-Host '  without them nothing runs after you close this window or log off.'
  Write-Host '  register once with: .\start.ps1 -Install'
}

# 5. window
#    -Restart means "pick up code changes", so the window must be re-opened as
#    well - a live page keeps the app.js it loaded before the restart.
if (-not $NoWindow) {
  Head 'opening the window'
  if ($Restart) {
    & (Join-Path $Scripts 'open-app.ps1') -Port $Port -NoWait -Reload
  } else {
    & (Join-Path $Scripts 'open-app.ps1') -Port $Port -NoWait
  }
}

Write-Host ''
Write-Host "ui   : http://127.0.0.1:$Port"
Write-Host 'stop : stop.bat  (or the window / tray "quit" - stops everything)'
if ($fresh -ne 0) {
  Write-Host 'note : the record is stale - open the window and check why.' -ForegroundColor Yellow
}
