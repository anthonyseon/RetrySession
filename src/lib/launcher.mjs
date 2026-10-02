/**
 * launcher.mjs — 창 없는 실행기 `start.exe --hidden` 을 찾는다(scripts/launcher-lib.ps1 의 Node 짝).
 *
 * 실행 파일은 start.exe 하나다(2026-10-02, runhidden.exe 를 `--hidden` 모드로 합쳤다).
 * 🔴 «있다» 로는 모자라다 — 합치기 전에 만든 start.exe 는 `--hidden` 을 몰라 그 인자를 start.ps1 에
 *   넘기고 매번 실패한다. 그래서 «이 모드를 아는 빌드인가» 를 이진 안의 문자열로 본다 —
 *   C# 문자열 상수는 UTF-16LE 로 들어 있다. 실행해 보지 않는다(예전 빌드에 주면 창이 뜬다).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME } from './config.mjs'

/** start.exe 의 «창 없이 띄우기» 스위치 — tools/Launcher.cs · scripts/launcher-lib.ps1 과 같은 글자다(시험이 묶는다) */
export const HIDDEN_SWITCH = '--hidden'

export const launcherFile = () => join(RS_HOME, 'start.exe')

/** start.exe 가 `--hidden` 을 아는 빌드인가. 파일이 없거나 못 읽으면 null(모름) */
export function launcherKnowsHidden(file = launcherFile(), read = readFileSync) {
  try { return read(file).includes(Buffer.from(HIDDEN_SWITCH, 'utf16le')) } catch { return null }
}
