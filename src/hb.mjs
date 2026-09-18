/**
 * hb.mjs - ASCII entry point for the heartbeat. Do not rename.
 *
 * Why a second file exists (measured, do not "simplify" this away)
 *   The Task Scheduler registration script is PowerShell, and PowerShell 5.1 reads
 *   .ps1 files as ANSI. A Korean character anywhere in the file kills the parser.
 *   So every path the scheduler touches must be ASCII. The real implementation is
 *   heartbeat.mjs; this file only forwards to it.
 *
 *   Node reads .mjs as UTF-8, so heartbeat.mjs may contain Korean freely.
 *
 * Runs once and exits - no long-lived timer. See heartbeat.mjs for why.
 */
import './heartbeat.mjs'
