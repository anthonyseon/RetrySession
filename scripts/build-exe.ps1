# build-exe.ps1 - build start.exe from tools\Launcher.cs.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI - see CLAUDE.md).
#
# start.exe is the ONLY executable (2026-10-02). It is the double-click entry
# point AND, as `start.exe --hidden <program> ...`, the windowless launcher the
# scheduled tasks use - the job runhidden.exe used to do.
#
# Uses csc.exe, the C# compiler that ships with Windows (.NET Framework 4.x).
# Nothing to install - that keeps the zero-dependency rule intact.
#
# /target:winexe means no console window is ever created, which is the whole
# point: a .bat would flash one, and cmd.exe is excluded here.
#
# The icon is generated here rather than committed: a 32x32 blue dot matching
# the tray, so the exe does not wear a generic default icon.
#
#   .\scripts\build-exe.ps1

$ErrorActionPreference = 'Stop'

$Root   = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root 'tools\Launcher.cs'
$OutExe = Join-Path $Root 'start.exe'
$IcoTmp = Join-Path $env:TEMP 'retrysession-launcher.ico'

. (Join-Path $PSScriptRoot 'launcher-lib.ps1')

if (-not (Test-Path $Source)) { throw "source not found: $Source" }

# ---- find csc.exe -------------------------------------------------------
$cscCandidates = @(
  "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
  Write-Host 'csc.exe (.NET Framework 4.x) was not found.' -ForegroundColor Red
  Write-Host '  start.ps1 still works on its own, but without start.exe the scheduled'
  Write-Host '  tasks fall back to a VISIBLE console window (they say so when registering):'
  Write-Host '  powershell -ExecutionPolicy Bypass -File start.ps1'
  exit 1
}
Write-Host "compiler : $csc"
Write-Host "source   : $Source"
Write-Host "output   : $OutExe"

# ---- generate the icon --------------------------------------------------
# Drawn, not stored, for the same reason the tray icon is drawn: one less
# binary asset that can drift out of sync with the palette.
try {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml('#2A78D6'))
  $g.FillEllipse($brush, 3, 3, 26, 26)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 0, 0, 0)), 2
  $g.DrawEllipse($pen, 3, 3, 26, 26)
  $brush.Dispose(); $pen.Dispose(); $g.Dispose()

  $ico = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $fs = [System.IO.File]::Create($IcoTmp)
  $ico.Save($fs)
  $fs.Close(); $ico.Dispose(); $bmp.Dispose()
  $haveIcon = Test-Path $IcoTmp
} catch {
  # An icon is cosmetic - never fail the build over it.
  Write-Host "icon     : skipped ($($_.Exception.Message))" -ForegroundColor Yellow
  $haveIcon = $false
}

# ---- compile ------------------------------------------------------------
# /codepage:65001 so the Korean strings in the launcher's error dialogs are
# read as UTF-8. Without it csc uses the ANSI codepage and mangles them.
$cscArgs = @(
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  '/codepage:65001',
  '/reference:System.dll',
  '/reference:System.Windows.Forms.dll',
  "/out:$OutExe"
)
if ($haveIcon) { $cscArgs += "/win32icon:$IcoTmp" }
$cscArgs += $Source

# ---- free the output path WITHOUT killing anything ----------------------
# start.exe now also wraps the long-lived tasks (UI server, tray) and waits on
# them. Killing it would leave the child running while Task Scheduler shows the
# task as stopped - two sources disagreeing. A running exe cannot be overwritten
# or deleted, but it CAN be renamed, so move it aside and build a fresh one.
# The renamed copies are removed on a later build, once nothing runs them.
Get-ChildItem -LiteralPath $Root -Filter 'start.exe.old-*' -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
if (Test-Path -LiteralPath $OutExe) {
  try {
    Remove-Item -LiteralPath $OutExe -Force -ErrorAction Stop
  } catch {
    $aside = 'start.exe.old-' + (Get-Date -Format 'yyyyMMddHHmmss')
    Rename-Item -LiteralPath $OutExe -NewName $aside
    Write-Host "in use   : the running start.exe was moved aside as $aside (removed on a later build)" -ForegroundColor DarkGray
  }
}

& $csc $cscArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host 'compile failed.' -ForegroundColor Red
  exit $LASTEXITCODE
}

if (-not (Test-Path $OutExe)) {
  Write-Host 'compiler reported success but start.exe is missing.' -ForegroundColor Red
  exit 1
}

# The scheduled tasks depend on the hidden mode - check the build really has it.
if (-not (Get-HiddenLauncher $Root)) {
  Write-Host "start.exe was built but does not know $HiddenSwitch - tasks would show a console window." -ForegroundColor Red
  exit 1
}

# ---- leftovers of the two-exe era ---------------------------------------
# runhidden.exe was merged into start.exe. A copy left behind reads as a live
# part, so remove it - unless an old task is still running through it.
$oldHidden = Join-Path $Root 'runhidden.exe'
if (Test-Path -LiteralPath $oldHidden) {
  try {
    Remove-Item -LiteralPath $oldHidden -Force -ErrorAction Stop
    Write-Host 'removed  : runhidden.exe (merged into start.exe --hidden)'
  } catch {
    Write-Host 'note     : runhidden.exe is still in use by an old task - re-register with .\start.exe -Install' -ForegroundColor Yellow
  }
}

$size = [Math]::Round((Get-Item $OutExe).Length / 1KB, 1)
Write-Host ''
Write-Host "built start.exe ($size KB)" -ForegroundColor Green
Write-Host '  double-click it, or:'
Write-Host '    .\start.exe            open the window'
Write-Host '    .\start.exe -Install   register the OS tasks (shows output)'
Write-Host '    .\start.exe -Status    print status'
Write-Host "  the scheduled tasks use it too, as: start.exe $HiddenSwitch <program> ..."
