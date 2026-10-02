@echo off
rem start.bat - run RetrySession. Double-click it, or run it from a terminal.
rem
rem ASCII ONLY: cmd.exe reads a .bat in the OEM codepage. CRLF line endings
rem (.gitattributes) - cmd.exe misreads labels and blocks in LF-only files.
rem
rem The pair start.bat / stop.bat is how a person runs and stops RetrySession
rem (user request 2026-10-02). They live in git, so a fresh clone can run at
rem once - start.exe is a build artifact and start.ps1 builds it when missing.
rem
rem This file only hands over to start.ps1 (Windows PowerShell 5.1, by absolute
rem path). Nothing long-lived runs under cmd.exe, and the scheduled tasks never
rem use this file: they start node through start.exe --hidden (no console).
rem
rem What start.ps1 does: builds start.exe if needed, enables the tasks a stop
rem disabled (registers monitor/UI/tray if missing - never the resumer), starts
rem the server and the tray, and opens the status window.
rem
rem This console shows that progress and closes when done. If something fails
rem it stays open so the reason can be read: a start that fails silently was
rem measured (2026-10-01 - a hidden start found no node and nobody saw it).
rem
rem   start.bat              start everything and open the window
rem   start.bat -Status      any start.ps1 switch is passed through

setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo start.ps1 ended with code %RC% - read the lines above.
  pause
)
exit /b %RC%
