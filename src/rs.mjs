/**
 * rs.mjs - ASCII entry point for the autonomous resumer. Do not rename.
 *
 * Same reason hb.mjs exists: PowerShell 5.1 reads .ps1 as ANSI, so any path the
 * Task Scheduler registration script names must be ASCII. The real implementation
 * is resume.mjs, which may contain Korean because Node reads .mjs as UTF-8.
 */
import './resume.mjs'
