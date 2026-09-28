/**
 * actions.mjs — 화면이 요청한 일을 **실제로 하는** 부분.
 *
 * 왜 나눴나
 *   server.mjs 가 406줄까지 자랐다(규칙은 400줄). 라우팅(누가·어디로)과
 *   실행·조립(무엇을)이 한 파일에 섞여 있었다. 여기는 뒤쪽만 맡는다 —
 *   접근 판정과 경로 규칙은 server.mjs 에 그대로 있다.
 */
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME } from '../lib/config.mjs'
import { tail } from '../lib/status.mjs'
import { sessionDetail } from '../lib/detail.mjs'
import { loadTargets, statePaths, resolveRepo, trackerPath } from '../lib/targets.mjs'
import { loadRunState, budgetVerdict } from '../lib/guard.mjs'
import { readTracker } from '../lib/tracker.mjs'
import { localStamp } from '../lib/stamp.mjs'

/* ── 지금 실행 (하트비트·재시작 수동 발동) ───────────────────── */

/**
 * **실행 직전에 최신 정보로 다시 판정한다.** `--dry-run` 을 한 번 돌려 그 답을 받는다.
 *
 * 🔴 왜 화면의 판정을 믿지 않는가 — 화면이 보여주는 것은 **몇 초 전에 받은 것**이다.
 *   자동갱신을 끄면 몇 분 전 것일 수도 있다. 그 사이 사람이 그 세션에 무언가 입력하거나,
 *   도구가 끝나거나, 제한이 풀릴 수 있다. 낡은 화면을 근거로 재개를 띄우면 사람이 쓰는
 *   대화에 끼어들 수 있고, 반대로 "가능"으로 보이던 것이 조용히 SKIP 될 수도 있다.
 *
 * 🔴 왜 판정을 여기서 다시 짜지 않고 `--dry-run` 을 돌리나 — 판정 재료를 조립하는 코드가
 *   세 곳(재개·화면·여기)이 되면 반드시 어긋난다. 실제 실행과 **같은 진입점**에 물어보면
 *   답이 갈릴 수 없다. dry-run 은 claude 를 띄우지 않으므로 싸다(실측 0.5~1.5초).
 *
 * 🔴 그리고 판정을 **응답에 담아 돌려준다.** 예전에는 떼어내 띄우고(detached) 끝이라
 *   SKIP 되어도 화면은 아무 말을 못 했다 — 로그를 열어야 알 수 있었다.
 *   누른 결과를 말하지 않는 화면은 고장난 화면과 구별되지 않는다.
 */
function freshVerdict(sessionId) {
  try {
    const out = execFileSync(process.execPath,
      [join(RS_HOME, 'src', 'resume.mjs'), '--dry-run', '--force', '--session', sessionId],
      { cwd: RS_HOME, encoding: 'utf8', timeout: 60_000, windowsHide: true })
    // 첫 줄이 판정이다: `✅ <id> 재개 가능 — 이유` / `⛔ <id> 건너뜀 — 이유`
    const line = out.split('\n').map((l) => l.trim()).find((l) => l.startsWith('✅') || l.startsWith('⛔')) || ''
    return {
      ok: true,
      go: line.startsWith('✅'),
      why: line.replace(/^[✅⛔]\s*\S+\s*(재개 가능|건너뜀)\s*(—\s*)?/, '') || line,
      line,
    }
  } catch (e) {
    // 🔴 판정을 못 받았으면 띄우지 않는다 — 모르는 채로 미는 것이 가장 나쁘다
    return { ok: false, go: false, why: `최신 판정을 받지 못했다 — ${e.message}`, line: '' }
  }
}

/**
 * 🔴 떼어내서 띄운다(detached). 재시작은 최대 30분 돌 수 있으므로 HTTP 응답을
 *   붙잡고 있으면 화면이 멈춘 것처럼 보인다. 진행은 로그로 본다.
 *
 * 🔴 **화면의 '지금 재시작 실행' 은 `--force` 로 띄운다** (사용자 지시 2026-09-28).
 *   사람이 단추를 누른 것은 «지금 돌려라»는 의지 표시다. 예약 회차를 위한 아껴 쓰기
 *   (하루 횟수·최소 간격·연속실패·조용한 시간)를 그 의지보다 앞세울 이유가 없다 —
 *   그래서 force 가 그것들을 건너뛰고, **재개지시가 있으면 그것으로 띄운다.**
 *
 *   🔴 그래도 뚫리지 않는 것이 있다(force 계약, `test/resume-force.test.mjs`):
 *     **일하는 중**(도구 대기·답 대기) · **제한 중** · 활동 시각 모름 · 저장소 잠금 ·
 *     이어갈 지점 없음. 사람의 의지로도 **사람이 쓰는 대화에는 끼어들지 않는다** —
 *     단추를 누른 사람과 그 세션을 쓰는 사람이 같다는 보장이 없고, 제한 중에는 어차피 실패한다.
 */
export function runNow(kind, sessionId) {
  /**
   * 재시작은 **최신 정보를 다시 읽은 뒤에만** 띄운다. 막히는 판정이면 띄우지 않고
   * 그 이유를 돌려준다 — 띄워 놓고 로그에서 SKIP 을 찾게 하지 않는다.
   * (하트비트는 판정이 없다. 기록만 남기므로 그대로 띄운다.)
   */
  if (kind === 'resume' && sessionId) {
    const v = freshVerdict(sessionId)
    if (!v.go) {
      return { started: false, kind, verdict: v, at: localStamp() }
    }
    const child = spawnResume(sessionId)
    return { started: true, kind, pid: child.pid, verdict: v, at: localStamp() }
  }
  const script = kind === 'resume' ? 'src/resume.mjs' : 'src/heartbeat.mjs'
  const args = [join(RS_HOME, script)]
  if (kind === 'resume' && sessionId) args.push('--session', sessionId)
  const child = spawn(process.execPath, args, {
    cwd: RS_HOME, detached: true, stdio: 'ignore', windowsHide: true,
  })
  child.unref()
  return { started: true, kind, pid: child.pid, at: localStamp() }
}

function spawnResume(sessionId) {
  const child = spawn(process.execPath,
    [join(RS_HOME, 'src', 'resume.mjs'), '--force', '--session', sessionId],
    { cwd: RS_HOME, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return child
}

/* ── 세션 상세 (감시·재시작 상태와 로그를 함께) ──────────────── */

export function detail(sessionId, { turns = 40 } = {}) {
  const d = sessionDetail(sessionId, { turns })
  const registry = loadTargets()
  const target = registry.targets[sessionId] || null

  let watchLog = [], restartLog = [], restart = null, heartbeat = null, tracker = null
  if (target) {
    const P = statePaths(sessionId)
    watchLog = tail(P.hbLogPath, 60)
    restartLog = tail(P.resumeLogPath, 120)
    try { heartbeat = JSON.parse(readFileSync(P.heartbeat, 'utf8')) } catch { heartbeat = null }

    const pairCwd = target.mainCwd || target.runCwd
    const { project } = pairCwd ? resolveRepo(pairCwd) : { project: null }
    if (project) {
      const st = loadRunState(P.resumeState)
      const b = budgetVerdict(st, project.resume)
      restart = {
        state: st, budget: b, config: project.resume, repoId: project.id,
        trackerFile: project.tracker || null,
      }
      // 상세 화면에서 재개 지점을 그대로 보여준다
      const tp = trackerPath(project)
      if (tp) tracker = readTracker(tp)
    }
  }
  return { ...d, target, heartbeat, watchLog, restartLog, restart, tracker }
}
