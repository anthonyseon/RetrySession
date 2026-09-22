# start.ps1 - the one file you run. Opens RetrySession and makes sure it is up.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI - see CLAUDE.md).
# No cmd.exe anywhere: executables are launched directly, hidden.
#
#   .\start.ps1                  bring everything up and open the window
#   .\start.ps1 -Install         also register the OS tasks + shortcuts (do this once)
#   .\start.ps1 -Install -WithResume   ... including the unattended resumer
#   .\start.ps1 -Restart         pick up code changes (see below)
#   .\start.ps1 -Status          just print status, open nothing
#   .\start.ps1 -Stop            stop the server and the tray (tasks stay registered)
#   .\start.ps1 -Uninstall       remove every OS task and stop everything
#   .\start.ps1 -Pc              check the PC power settings this tool needs
#   .\start.ps1 -Pc -Apply       and set them (reversible: -Pc -Restore)
#
# -Restart exists because of a measured trap: a plain start finds the server
# "already up" and leaves it alone, but a live node process keeps the modules it
# loaded at startup. So after editing anything under src\, the window keeps
# showing the OLD behaviour and nothing warns you. -Restart frees the port and
# starts clean.
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
# Launcher that starts a child with CREATE_NO_WINDOW (tools/RunHidden.cs).
# Used wherever we start a console program, because `-WindowStyle Hidden` does
# not prevent a window when Windows Terminal is the default console host.
$RunHidden = Join-Path $Root 'runhidden.exe'

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

function Test-Server {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/tray" -TimeoutSec 3 -UseBasicParsing
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
if ($Stop) {
  Head 'stopping server and tray'
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        Write-Host "  server pid $_" -ForegroundColor Yellow
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
  } catch { }

  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*-File*\tray.ps1*' } |
    ForEach-Object {
      Write-Host "  tray pid $($_.ProcessId)" -ForegroundColor Yellow
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

  Write-Host ''
  Write-Host 'stopped. The OS tasks are still registered, so both come back at next logon.'
  Write-Host '  to remove them too: .\start.ps1 -Uninstall'
  exit 0
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
    # Go through runhidden.exe. `-WindowStyle Hidden` is not enough: the console
    # is allocated before the child runs, and on Windows 11 the default console
    # host is Windows Terminal, whose window that flag does not control
    # (measured - that is how the tray task ended up showing one all day).
    Write-Host 'server   : task not registered - starting it directly for now'
    $serverArgs = @("`"$(Join-Path $Root 'src\ui\server.mjs')`"", '--port', $Port)
    if (Test-Path $RunHidden) {
      Start-Process -FilePath $RunHidden -WorkingDirectory $Root `
        -ArgumentList (@("`"$node`"") + $serverArgs)
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
    if (Test-Path $RunHidden) {
      Start-Process -FilePath $RunHidden -WorkingDirectory $Root -ArgumentList @(
        $psExe, '-NoProfile', '-ExecutionPolicy', 'Bypass',
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
if (-not $NoWindow) {
  Head 'opening the window'
  & (Join-Path $Scripts 'open-app.ps1') -Port $Port -NoWait
}

Write-Host ''
Write-Host "ui   : http://127.0.0.1:$Port"
Write-Host 'stop : .\start.ps1 -Stop'
if ($fresh -ne 0) {
  Write-Host 'note : the record is stale - open the window and check why.' -ForegroundColor Yellow
}
