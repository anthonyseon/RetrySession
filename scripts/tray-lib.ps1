# tray-lib.ps1 - leaf helpers for tray.ps1: wording and the status dot.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
#
# Split out because tray.ps1 passed the 400 line rule. These two are LEAVES:
# they touch no tray state and nothing in the polling state machine, so moving
# them cannot bring back the menu freeze that was just fixed.
#
# Dot-sourced by tray.ps1 (. $PSScriptRoot	ray-lib.ps1) so it shares scope -
# $Root and $L stay visible to both files.
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
