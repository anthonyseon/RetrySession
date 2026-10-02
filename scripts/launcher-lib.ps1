# launcher-lib.ps1 - find the windowless launcher: start.exe --hidden.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI - see CLAUDE.md).
#
# Since 2026-10-02 there is ONE executable, start.exe. Started as
#   start.exe --hidden <program> [args...]
# it does what runhidden.exe used to do: start a console program with
# CREATE_NO_WINDOW, wait, and return its exit code. Every place that starts
# node.exe or powershell.exe goes through it (CLAUDE.md 3-3, tools\Launcher.cs).
#
# Existence is not enough. An OLD start.exe (built before the merge) does not
# know --hidden: it would forward "--hidden node.exe ..." to start.ps1, which
# fails on every run - silently, because the task has no window. So we look for
# the switch inside the binary. C# string literals are stored as UTF-16LE, so
# the bytes are the switch with a NUL after each character. The exe is ~10 KB;
# reading it costs nothing. src/lib/ready.mjs does the same check.
#
# Dot-sourced:  . (Join-Path $PSScriptRoot 'launcher-lib.ps1')
#   $HiddenSwitch            the switch text (tied to Launcher.cs by a test)
#   Get-HiddenLauncher $Root full path of start.exe, or $null if missing / old

$HiddenSwitch = '--hidden'

function Get-HiddenLauncher([string]$Root) {
  $exe = Join-Path $Root 'start.exe'
  if (-not (Test-Path -LiteralPath $exe)) { return $null }
  try {
    $bytes = [System.IO.File]::ReadAllBytes($exe)
  } catch {
    return $null    # cannot read it -> do not trust it (fail-closed)
  }
  # Latin-1 maps every byte to one char, so a byte search becomes a string search.
  $text = [System.Text.Encoding]::GetEncoding(28591).GetString($bytes)
  $needle = -join ($HiddenSwitch.ToCharArray() | ForEach-Object { [string]$_ + [char]0 })
  if ($text.Contains($needle)) { return $exe }
  return $null
}
