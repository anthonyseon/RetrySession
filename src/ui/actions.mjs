/**
 * actions.mjs — 화면이 요청한 일을 **실제로 하는** 부분.
 *
 * 왜 나눴나
 *   server.mjs 가 406줄까지 자랐다(규칙은 400줄). 라우팅(누가·어디로)과
 *   실행·조립(무엇을)이 한 파일에 섞여 있었다. 여기는 뒤쪽만 맡는다 —
 *   접근 판정과 경로 규칙은 server.mjs 에 그대로 있다.
 */
import { spawn } from 'node:child_process'
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
 * 🔴 떼어내서 띄운다(detached). 재시작은 최대 30분 돌 수 있으므로 HTTP 응답을
 *   붙잡고 있으면 화면이 멈춘 것처럼 보인다. 진행은 로그로 본다.
 */
export function 지금실행(kind, sessionId) {
  const script = kind === 'resume' ? 'src/resume.mjs' : 'src/heartbeat.mjs'
  const args = [join(RS_HOME, script)]
  if (kind === 'resume' && sessionId) args.push('--session', sessionId)
  const child = spawn(process.execPath, args, {
    cwd: RS_HOME, detached: true, stdio: 'ignore', windowsHide: true,
  })
  child.unref()
  return { 시작됨: true, kind, pid: child.pid, at: localStamp() }
}

/* ── 세션 상세 (감시·재시작 상태와 로그를 함께) ──────────────── */

export function 상세(sessionId, { turns = 40 } = {}) {
  const d = sessionDetail(sessionId, { turns })
  const 등록 = loadTargets()
  const 대상 = 등록.targets[sessionId] || null

  let 감시로그 = [], 재시작로그 = [], 재시작 = null, 하트비트 = null, 추적기 = null
  if (대상) {
    const P = statePaths(sessionId)
    감시로그 = tail(P.하트비트로그, 60)
    재시작로그 = tail(P.재개로그, 120)
    try { 하트비트 = JSON.parse(readFileSync(P.하트비트, 'utf8')) } catch { 하트비트 = null }

    const 짝 = 대상.주작업cwd || 대상.실행cwd
    const { project } = 짝 ? resolveRepo(짝) : { project: null }
    if (project) {
      const st = loadRunState(P.재개상태)
      const b = budgetVerdict(st, project.재개)
      재시작 = {
        상태: st, 예산: b, 설정: project.재개, 저장소id: project.id,
        추적기경로: project.tracker || null,
      }
      // 상세 화면에서 재개 지점을 그대로 보여준다
      const tp = trackerPath(project)
      if (tp) 추적기 = readTracker(tp)
    }
  }
  return { ...d, 대상, 하트비트, 감시로그, 재시작로그, 재시작, 추적기 }
}
