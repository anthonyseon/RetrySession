# pc-settings.ps1 - read and change the PC power settings RetrySession depends on.
#
# ASCII ONLY (PowerShell 5.1 reads .ps1 as ANSI).
# This script only READS and WRITES. The judgement ("is this value acceptable")
# lives in src/lib/pc.mjs, where it can be tested. Same split as the scheduler:
# the .ps1 is a data source, the .mjs decides.
#
# WHY THIS EXISTS
#   Everything here runs from OS scheduled tasks. A sleeping PC runs nothing -
#   the 5 minute monitor simply stops, and the gap looks exactly like the
#   9 hour outage this tool was built after. Measured on this machine: 4 nights,
#   84 heartbeat records each night (7h x 12), zero gaps - because sleep is off.
#   On a machine where sleep is ON, none of that happens.
#
# GUIDS, NOT ALIASES
#   `powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE` depends on aliases
#   that are not registered on every machine (measured: LIDACTION returned
#   nothing here). GUIDs always work.
#
# LOCALE
#   powercfg prints in the system language, so no label can be matched. But the
#   layout is fixed: the last two hex values in the block are the AC index then
#   the DC index. That is what we read. (This repo already lost a day to
#   schtasks cp949 mojibake - never parse localised labels.)
#
# ADMIN
#   Not required. These are per-user power scheme values.

[CmdletBinding()]
param(
  [switch]$Json,
  # Values to write. Only the ones given are written. -1 means "leave alone".
  [int]$StandbyAc   = -1,
  [int]$HibernateAc = -1,
  [int]$LidAc       = -1,
  [int]$StandbyDc   = -1,
  [int]$HibernateDc = -1,
  [int]$LidDc       = -1
)

$ErrorActionPreference = 'Stop'

$SUB_SLEEP     = '238c9fa8-0aad-41ed-83f4-97be242c8f20'
$STANDBYIDLE   = '29f6c1db-86da-48c5-9fdb-f2b67b1f44da'
$HIBERNATEIDLE = '9d7815a6-7ee4-497e-8888-515a05f02364'
$SUB_BUTTONS   = '4f971e89-eebd-4455-a8de-9e59040e7347'
$LIDACTION     = '5ca83367-6e45-459f-a27b-476b1d01c936'

# Returns @(ac, dc) in seconds (or the raw action code for LIDACTION).
# $null means "could not read" - the caller must not treat that as 0.
function Get-Pair([string]$sub, [string]$setting) {
  $hex = @()
  try {
    foreach ($line in (powercfg /query SCHEME_CURRENT $sub $setting 2>$null)) {
      $m = [regex]::Match([string]$line, '0x([0-9a-fA-F]{8})')
      if ($m.Success) { $hex += [Convert]::ToInt64($m.Groups[1].Value, 16) }
    }
  } catch { return @($null, $null) }
  if ($hex.Count -lt 2) { return @($null, $null) }
  return @($hex[$hex.Count - 2], $hex[$hex.Count - 1])
}

function Set-Value([string]$sub, [string]$setting, [int]$ac, [int]$dc) {
  if ($ac -ge 0) { powercfg /setacvalueindex SCHEME_CURRENT $sub $setting $ac | Out-Null }
  if ($dc -ge 0) { powercfg /setdcvalueindex SCHEME_CURRENT $sub $setting $dc | Out-Null }
}

# ---- write (only when asked) --------------------------------------------
$wrote = $false
if ($StandbyAc -ge 0 -or $StandbyDc -ge 0) { Set-Value $SUB_SLEEP $STANDBYIDLE $StandbyAc $StandbyDc; $wrote = $true }
if ($HibernateAc -ge 0 -or $HibernateDc -ge 0) { Set-Value $SUB_SLEEP $HIBERNATEIDLE $HibernateAc $HibernateDc; $wrote = $true }
if ($LidAc -ge 0 -or $LidDc -ge 0) { Set-Value $SUB_BUTTONS $LIDACTION $LidAc $LidDc; $wrote = $true }
# A scheme change only takes effect once the scheme is re-activated.
if ($wrote) { powercfg /setactive SCHEME_CURRENT | Out-Null }

# ---- read ----------------------------------------------------------------
$standby   = Get-Pair $SUB_SLEEP $STANDBYIDLE
$hibernate = Get-Pair $SUB_SLEEP $HIBERNATEIDLE
$lid       = Get-Pair $SUB_BUTTONS $LIDACTION

# Is hibernation available at all? If not, HIBERNATEIDLE cannot fire.
$hibernateAvailable = $false
try {
  $a = (powercfg /availablesleepstates 2>$null) -join "`n"
  # The word "Hibernate" is not localised in the state list on any locale we
  # have seen, but absence of the S4 line is the reliable signal either way.
  $hibernateAvailable = ($a -match 'Hibernate' -or $a -match 'S4')
} catch { $hibernateAvailable = $false }

$battery = $null -ne (Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue)
$locked  = $null -ne (Get-Process LogonUI -ErrorAction SilentlyContinue)

# ASCII keys - src/lib/pc.mjs names them in code.
$out = [ordered]@{
  ok                 = $true
  wrote              = $wrote
  standbyAc          = $standby[0]
  standbyDc          = $standby[1]
  hibernateAc        = $hibernate[0]
  hibernateDc        = $hibernate[1]
  lidAc              = $lid[0]
  lidDc              = $lid[1]
  hibernateAvailable = $hibernateAvailable
  hasBattery         = $battery
  lockedNow          = $locked
}

if ($Json -or -not $wrote) {
  $out | ConvertTo-Json -Compress
} else {
  $out | ConvertTo-Json -Compress
}
