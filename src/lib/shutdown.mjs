/**
 * shutdown.mjs — 화면의 «종료» 단추(POST /api/shutdown)가 부른다. RetrySession 전부를 끄는
 * scripts/stop-all.ps1 을 띄운다 — stop.bat · 트레이 «종료» 와 **같은 스크립트**다(사용자 요청 2026-10-02).
 *
 * 🔴 그 스크립트는 **이 서버도** 끈다. 그래서
 *   ① 답을 먼저 보내고 조금 뒤(delayMs)에 띄운다 — 화면이 «종료했다» 를 받기 전에 서버가 죽으면
 *     눌렀는데 아무 말이 없는 단추가 된다(이 저장소가 여러 번 고친 고장이다).
 *   ② stop-all.ps1 은 자기를 띄운 쪽(이 서버)을 **맨 마지막에** 끈다. Windows 에서 자식은 부모가
 *     죽어도 산다 — 끝까지 간다.
 * 🔴 `detached: true` 를 쓰지 마라. 실측 결함(2026-10-02): 화면은 «종료함» 이라 했는데 아무것도 꺼지지
 *   않았다 — DETACHED_PROCESS 로 띄운 PowerShell 5.1 은 콘솔이 없어 **스크립트를 한 줄도 돌리지 않고**
 *   끝난다(대조 실험: detached 0/2 · 숨김 2/2 · start.exe --hidden 2/2). 그래서 다른 곳과 같은 규칙이다 —
 *   `start.exe --hidden` 으로 띄우고(콘솔은 만들되 창은 없다, CLAUDE.md §3-3), 실행기가 없거나 낡았으면
 *   windowsHide 로 물러선다. 셸은 거치지 않는다(§3-1). `by` 는 기록용 단어 하나만 받는다.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { RS_HOME } from './config.mjs'
import { localStamp } from './stamp.mjs'
import { HIDDEN_SWITCH, launcherFile, launcherKnowsHidden } from './launcher.mjs'

const powershellExe = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/** 누가 껐는지 — 기록에 남는 단어. 모르는 값은 'ui' 로 읽는다(인자에 아무 글자나 넣지 않는다) */
export const stopperName = (by) => (typeof by === 'string' && /^[a-z][a-z.-]{0,15}$/.test(by) ? by : 'ui')

/**
 * stop-all.ps1 을 띄우는 명령. 순수 함수 — 시험이 모양을 본다.
 * @param hasLauncher start.exe 가 `--hidden` 을 아는가(launcher.mjs). 아니면 PowerShell 을 숨겨 직접 띄운다
 */
export function stopCommand(by, hasLauncher = launcherKnowsHidden() === true) {
  const ps = powershellExe()
  const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(RS_HOME, 'scripts', 'stop-all.ps1'), '-By', stopperName(by)]
  const opts = { cwd: RS_HOME, detached: false, stdio: 'ignore', windowsHide: true, shell: false }
  return hasLauncher
    ? { exe: launcherFile(), args: [HIDDEN_SWITCH, ps, ...psArgs], opts }
    : { exe: ps, args: psArgs, opts }
}

function launch({ exe, args, opts }) {
  const child = spawn(exe, args, opts)
  child.on('error', () => { /* 띄우지 못했으면 서버가 살아 있다 — 화면은 다음 폴링에서 그대로 본다 */ })
  child.unref()
}

/**
 * 끄기를 **예약**하고 바로 답할 것을 돌려준다.
 * @param by 누가 눌렀나(기록용) · @param delayMs 답이 나갈 틈 · @param run 띄우는 함수(시험에서 갈아 끼운다)
 */
export function startStopAll(by, { delayMs = 400, run = launch, later = setTimeout } = {}) {
  const cmd = stopCommand(by)
  later(() => { try { run(cmd) } catch { /* 위와 같다 */ } }, delayMs)
  return {
    ok: true, at: localStamp(), by: stopperName(by),
    note: '몇 초 안에 서버·트레이·감시·재시작 회차·상태 창이 모두 멈추고 예약 작업이 꺼진다. 다시 켜려면 start.bat',
  }
}
