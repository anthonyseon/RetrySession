@echo off
rem stop.bat - stop RetrySession COMPLETELY.
rem
rem ASCII ONLY: cmd.exe reads a .bat in the OEM codepage. CRLF line endings.
rem
rem Runs scripts\stop-all.ps1, the same off switch as the tray menu "quit" and
rem the status window's quit button (user request 2026-10-02):
rem   - disables every RetrySession scheduled task, so nothing comes back on its
rem     own (not removed - start.bat enables them again, -WithResume included)
rem   - ends the status server, the tray, the 5-minute monitor, a resume run in
rem     flight (with the claude it started) and the status window
rem   - then checks that nothing is left, and says so
rem
rem Only RetrySession's own processes are touched - VS Code and Claude Code
rem sessions that merely have this folder open are left alone.
rem
rem   stop.bat

setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-all.ps1" -By stop.bat %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo stop-all.ps1 ended with code %RC% - something is still running, see above.
  pause
  exit /b %RC%
)
rem a moment to read the result before the window closes
"%SystemRoot%\System32\timeout.exe" /t 5 >nul 2>nul
exit /b 0
