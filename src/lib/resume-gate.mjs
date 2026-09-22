/**
 * resume-gate.mjs — "지금 이 세션을 재개해도 되나" **판정 하나.**
 *
 * 🔴 왜 떼어냈나 (실측 결함, 2026-09-22)
 *   판정은 resume.mjs 안에 있었고, 화면은 **예산만** 보고 "재시작 준비"라고 말했다.
 *   그런데 실제로는 여덟 가지가 더 막는다 — 실행 중 · 재개 지점 없음 · 저장소 잠금 ·
 *   조용한 시간 · 사용량 제한 · 최근 활동 · 차단 · 추적기 전부 done.
 *   그래서 화면은 **"준비"라고 말하고 15분마다 조용히 건너뛰는** 상태가 만들어졌다.
 *   사용자가 실제로 물은 것이 그것이다 — "재시작을 켰는데 왜 안 도는가".
 *
 *   있는 것을 없다고 하는 것만큼 **없는 것을 있다고 하는 것도** 나쁘다.
 *   규칙을 두 벌 만들지 않는다: resume.mjs 가 이것으로 정하고, 화면이 같은 것을 보여준다.
 *
 * 🔴 순수 함수다. 파일도 프로세스도 건드리지 않는다 — 그래야 시험할 수 있고,
 *   화면이 3초마다 불러도 공짜다.
 */
import { quietNow, limitState, budgetVerdict } from './guard.mjs'

/** 막히는 자리의 이름 — 화면이 색과 문구를 고르는 기준 */
export const GATE = {
  off: 'off', repo: 'repo', quiet: 'quiet', running: 'running', gone: 'gone',
  limited: 'limited', active: 'active', tracker: 'tracker', point: 'point',
  repeated: 'repeated', budget: 'budget', blocked: 'blocked',
}

/**
 * @param target   등록부 항목 {restart, resumePrompt, …}
 * @param project  resolveRepo 로 찾은 저장소 (없으면 null)
 * @param state    loadRunState 결과
 * @param session  세션 집계 {activeMin, stoppedByLimit, stoppedByInterrupt, quota}
 * @param running  {running, isCertain, why} — sessionRunning 결과와 같은 모양
 * @param tracker  {exists, error, allDone, doing, nextTodo, doneMark} (없으면 null)
 * @param force    --force 로 부른 것인가 (조용한시간·활동·예산만 건너뛴다)
 * @returns {{go:boolean, why:string|null, point:string|null, stage:string|null}}
 */
export function resumeGate({ target, project, state = {}, session, running, tracker = null, quota = null, force = false, now = Date.now() }) {
  const cfg = project?.resume || {}
  const no = (stage, why) => ({ go: false, why, stage, point: null })

  if (!target?.restart && !force) return no(GATE.off, '재시작이 꺼져 있다 (UI 에서 켜라)')
  if (!project) return no(GATE.repo, '작업 디렉터리를 알 수 없다 — 재개를 띄울 자리가 없다')

  // 저장소 단위 잠금 — --force 로도 못 뚫는다
  if (cfg.enabled === false) {
    return no(GATE.repo, `이 저장소는 자율 재개가 꺼져 있다 — config/projects.json 의 "${project.id}" 에서 resume.enabled 를 켜라`)
  }

  if (!force) {
    const qn = quietNow(cfg.quietHours, new Date(now))
    if (qn.quiet) return no(GATE.quiet, qn.why)
  }

  // 실행 중 확인은 force 로도 건너뛰지 않는다 (fail-closed: 모르면 돌고 있다고 본다)
  if (running?.running) return no(GATE.running, running.why)

  if (!session) return no(GATE.gone, '세션을 찾을 수 없다 — 트랜스크립트가 정리된 것으로 보인다')

  // 사용량 제한도 force 로 못 뚫는다 — 제한이 차단기를 태우는 것을 막는다
  const limitInfo = limitState(session.quota ?? quota, now)
  if (limitInfo.limited) return no(GATE.limited, limitInfo.why)

  if (!force) {
    const limit = cfg.sessionActiveMin ?? 10
    if (session.activeMin !== null && session.activeMin !== undefined && session.activeMin < limit) {
      return no(GATE.active, `방금까지 활동이 있었다 (${session.activeMin}분 전, 한계 ${limit}분) — 아직 사람이 붙어 있을 수 있다`)
    }
  }

  /* 재개 지점 — 넷 중 하나 */
  const limitStopped = !!session.stoppedByLimit
  const interrupted = !!session.stoppedByInterrupt
  const hasTracker = !!tracker?.exists
  if (hasTracker) {
    if (tracker.error) return no(GATE.tracker, `추적기를 읽을 수 없다 — ${tracker.error}`)
    if (tracker.allDone) return no(GATE.tracker, `할 일이 없다 (${tracker.doneMark} 전부 done)`)
    if (!tracker.doing && !tracker.nextTodo) return no(GATE.tracker, '추적기에 doing 도 todo 도 없다 — 재개 지점을 말해주지 않는다')
  } else if (!target.resumePrompt && !limitStopped && !interrupted) {
    return no(GATE.point, '추적기도 재개지시도 없다 — 무엇을 이어서 할지 정해지지 않았다 (설정 탭에서 재개지시를 넣어라)')
  }

  const point = hasTracker
    ? (tracker.doing ? `doing ${tracker.doing.id}` : `todo ${tracker.nextTodo.id}`)
    : target.resumePrompt ? '재개지시'
      : limitStopped ? '제한으로 잘린 지점'
        : '끊긴 지점'

  // 끊긴 응답은 한 번만 이어 본다 — 또 끊겼다면 원인이 절전이 아니다
  if (point === '끊긴 지점' && state.lastRun?.point === '끊긴 지점') {
    return no(GATE.repeated, '끊긴 응답을 이미 한 번 이어 봤는데 또 끊겼다 — 원인이 절전이 아니다. 재개지시로 방향을 바꿔라')
  }

  if (!force) {
    const b = budgetVerdict(state, cfg, now)
    if (!b.ok) return no(state.blocked ? GATE.blocked : GATE.budget, b.why)
  }

  return {
    go: true, stage: null, point,
    why: `재개 지점 ${point}`
      + (limitStopped ? ' (사용량 제한으로 중단됐고 지금은 풀렸다)' : '')
      + (interrupted && !limitStopped ? ' (응답이 끝까지 오지 못하고 끊겼다)' : ''),
  }
}
