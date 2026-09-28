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

  /**
   * 실행 중이면 막는다 — 사람이 쓰는 대화에 끼어들지 않는다. force 로도 건너뛰지 않고,
   * 모르면 돌고 있다고 본다(fail-closed).
   *
   * 🔴 **단 하나의 예외: 사용량 제한에 잘린 채 멈춰 있고 그 제한이 풀렸을 때.**
   *
   *   실측 (2026-09-28): 이 도구를 만든 목적이 정확히 이 경우인데 여섯 달째 한 번도
   *   돌지 않았다. 등록된 세션의 재시작 로그:
   *     `SKIP ×539 (처음 2026-09-22 16:18:15) · 세션이 실행 중이다 (pid 4084)`
   *   같은 시각 실제 상태: 제한 잘림 O · 제한 해제 9분 전 · 마지막 활동 38.7분 전.
   *   제한에 걸리면 CLI 프로세스는 **살아서 멈춰 선다.** 그래서 pid 는 계속 잡히고,
   *   "사람이 쓰는 중"으로 읽혀 영원히 건너뛴다. 제한이 풀리는 순간 이어받는 것이
   *   이 도구의 존재 이유인데, 그 순간이 오면 오히려 확실히 막히는 구조였다.
   *
   * 🔴 왜 이 예외가 안전한가 — 판단 근거를 **pid 가 아니라 트랜스크립트**로 옮긴다.
   *   `stoppedByLimit` 은 "마지막 엔트리가 제한 알림"이라는 뜻이다. 사람이 무엇이든
   *   입력하면 `user` 엔트리가 그 표시를 즉시 끈다(sessions 의 접기 규칙). 즉 이 값이
   *   참인 동안은 **제한 알림 뒤로 사람이 한 글자도 넣지 않았다**는 관측이다.
   *   pid 생존보다 이것이 "사람이 붙어 있나"를 더 정확히 말해 준다.
   *
   *   그리고 이 예외는 다른 관문을 열지 않는다 — 제한이 아직 안 풀렸으면 아래 `limited`
   *   가 막고, 방금까지 활동이 있었으면 `active` 가 막는다(기본 10분: 제한 알림 뒤로
   *   10분은 조용해야 한다). **`stoppedByLimit` 이 아닌 이유로는 살아 있는 세션에 들어가지
   *   않는다** — 끊김·재개지시·추적기만으로는 여전히 `running` 에서 멈춘다.
   */
  if (running?.running) {
    if (!session?.stoppedByLimit) return no(GATE.running, running.why)
    /**
     * 제한에 잘려 멈춘 세션이다. 아직 안 풀렸으면 **제한을 이유로** 말한다 —
     * "사람이 쓰는 중"이라고 하면 거짓이고, 남은 시간을 알려주는 쪽이 쓸모 있다
     * ("왜 안 도나"에 대한 답이 곧 "몇 분 뒤에 돈다"가 된다).
     */
    const li = limitState(session.quota ?? quota, now)
    if (li.limited) return no(GATE.limited, li.why)
  }

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

  /**
   * 🔴 **잘린 자리는 추적기의 "할 일 없음"보다 우선한다.**
   *
   *   실측 (2026-09-28): 제한에 잘린 세션이 `SKIP · 할 일이 없다 (9/9 전부 done)` 으로
   *   건너뛰어졌다. 추적기는 계획표일 뿐이고, **제한 알림은 그 계획 밖에서 일이 끊겼다는
   *   관측**이다. 계획이 다 done 이라고 해서 끊긴 응답이 끊긴 게 아니게 되지 않는다.
   *   여기서 막으면 "제한이 풀리면 이어받는다"는 이 도구의 목적이 추적기 한 줄로 꺼진다.
   *
   *   빈손으로 깨우는 것은 지시문이 막는다 — 재개 지시문에는 "이미 끝난 일이었다면
   *   아무것도 하지 말고 그렇게 답하라"가 들어 있다(lib/prompt.mjs).
   *   그리고 한 번 이어받으면 트랜스크립트가 자라 `stoppedByLimit` 이 꺼지므로
   *   같은 자리를 반복해서 밀지 않는다.
   */
  const cutPoint = limitStopped || interrupted

  if (hasTracker) {
    if (tracker.error && !cutPoint) return no(GATE.tracker, `추적기를 읽을 수 없다 — ${tracker.error}`)
    if (!tracker.error && !tracker.doing && !tracker.nextTodo && !cutPoint) {
      return no(GATE.tracker, tracker.allDone
        ? `할 일이 없다 (${tracker.doneMark} 전부 done)`
        : '추적기에 doing 도 todo 도 없다 — 재개 지점을 말해주지 않는다')
    }
  } else if (!target.resumePrompt && !cutPoint) {
    return no(GATE.point, '추적기도 재개지시도 없다 — 무엇을 이어서 할지 정해지지 않았다 (설정 탭에서 재개지시를 넣어라)')
  }

  // 추적기가 할 일을 말해 주면 그것이 가장 구체적이다. 없으면 잘린 자리로 간다.
  const point = (hasTracker && !tracker.error && (tracker.doing || tracker.nextTodo))
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
      + (interrupted && !limitStopped ? ' (응답이 끝까지 오지 못하고 끊겼다)' : '')
      // 로그가 사실을 말해야 한다 — 살아 있는 프로세스에 이어붙인 회차임을 남긴다
      + (running?.running ? ' · 프로세스는 살아 있지만 제한 알림 뒤로 사람의 입력이 없다' : ''),
  }
}
