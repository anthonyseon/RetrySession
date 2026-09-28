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
  off: 'off', repo: 'repo', quiet: 'quiet', busy: 'busy', unknown: 'unknown', gone: 'gone',
  limited: 'limited', active: 'active', tracker: 'tracker', point: 'point',
  repeated: 'repeated', budget: 'budget', blocked: 'blocked',
}

/**
 * @param target   등록부 항목 {restart, resumePrompt, …}
 * @param project  resolveRepo 로 찾은 저장소 (없으면 null)
 * @param state    loadRunState 결과
 * @param session  세션 집계 {activeMin, openTools, lastKind, stoppedByLimit, stoppedByInterrupt, quota}
 *                 🔴 '사람이 쓰는 중인가' 는 pid 가 아니라 이 값들로 판정한다
 * @param tracker  {exists, error, allDone, doing, nextTodo, doneMark} (없으면 null)
 * @param force    --force 로 부른 것인가 (조용한시간·활동·예산만 건너뛴다)
 * @returns {{go:boolean, why:string|null, point:string|null, stage:string|null}}
 */
export function resumeGate(input) {
  /**
   * 🔴 `= {}` 로는 부족하다 — 그건 `undefined` 만 막고 `null` 은 그대로 던진다.
   *   판정이 던지면 그 회차가 죽고, 죽은 회차는 이유를 남기지 못한다.
   */
  const {
    target, project, state = {}, session, tracker = null, quota = null, force = false, now = Date.now(),
  } = input || {}
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

  if (!session) return no(GATE.gone, '세션을 찾을 수 없다 — 트랜스크립트가 정리된 것으로 보인다')

  /**
   * 🔴 **프로세스가 살아 있다 ≠ 사람이 그 세션을 쓰고 있다.**
   *
   *   창을 열어 둔 채 다른 세션에서 일하는 것이 보통이다. pid 만 보면 그 세션은 영원히
   *   "사용 중"이고, 그러면 이 도구는 아무 일도 하지 않는다 — 실측(2026-09-22~09-28)으로
   *   등록된 세션이 **560회 연속** `세션이 실행 중이다 (pid …)` 로 건너뛰어졌다.
   *   제한이 풀리는 순간 이어받는 것이 목적인데 그 순간이 오히려 확실히 막히는 구조였다.
   *
   *   그래서 "쓰고 있나"를 pid 가 아니라 **그 세션의 기록**으로 판정한다. 두 가지만 본다:
   *     ① 결과를 기다리는 도구가 있나 → 도구가 도는 중이다
   *     ② 마지막 차례가 사람인가     → 모델이 답을 빚지고 있다(사람이 방금 물었거나 도구가 막 끝났다)
   *   하나라도 참이면 **일하는 중**이라 건드리지 않는다. 둘 다 아니면 그 세션은 모델이
   *   답을 마치고 **사람을 기다리는** 상태다 — 사람이 그 세션에 지시하고 있지 않다는 뜻이고,
   *   이어받아야 하는 바로 그 자리다.
   *
   *   ①이 없으면 구멍이 난다: 10분 걸리는 빌드가 도는 동안 트랜스크립트는 한 줄도 늘지
   *   않아 "조용하다"가 참이 된다. ②가 없으면 도구 없이 오래 생각하는 답이 같은 구멍이다.
   *   그 위에 `active`(기본 3분)가 한 겹 더 있다 — 방금 무슨 줄이든 늘었으면 기다린다.
   *
   * 🔴 이 차단에도 **끝이 있어야 한다.** 세션이 도구 도중에 죽거나 사람의 질문에 답하지
   *   못한 채 끊기면 위 두 신호가 영원히 참으로 남는다. 끝 없는 차단은 fail-open 만큼
   *   나쁘다 — 한 회차 타임아웃(기본 30분)보다 오래 조용하면 낡은 것으로 보고 통과시킨다.
   *   그만큼 조용했다면 그 도구는 끝났거나 세션이 죽은 것이다(그래서 이어받아야 한다).
   */
  const limitInfo = limitState(session.quota ?? quota, now)
  if (limitInfo.limited) return no(GATE.limited, limitInfo.why)   // force 로도 못 뚫는다

  const quiet = session.activeMin
  const knownQuiet = quiet !== null && quiet !== undefined && Number.isFinite(quiet)
  /**
   * 🔴 조용한지 **모르면 막는다.** 이 값이 없으면 "사람이 쓰고 있나"에 답할 수 없고,
   *   모르는 것을 "괜찮다"로 읽는 것이 이 저장소가 가장 여러 번 다친 방식이다.
   *   force 로도 뚫지 않는다 — 모르는 채로 사람의 대화에 끼어드는 것이 최악이다.
   */
  if (!knownQuiet) {
    return no(GATE.unknown, '마지막 활동 시각을 알 수 없다 — 그 세션을 쓰는 중인지 판정할 수 없다')
  }
  const stale = quiet >= (cfg.timeoutMin ?? 30)
  if (!stale) {
    const open = session.openTools || 0
    if (open > 0) {
      return no(GATE.busy, `도구 ${open}개가 결과를 기다리는 중이다 — 일하는 세션에 끼어들지 않는다`)
    }
    if (session.lastKind === 'user') {
      return no(GATE.busy, '마지막 차례가 사람이다 — 답이 아직 나오지 않았으므로 일하는 중이다')
    }
  }
  if (!force) {
    /**
     * 조용해야 하는 시간. 정본은 `config/projects.json` 의 `defaults.resume.sessionActiveMin`
     * 이고 여기 값은 설정을 못 읽었을 때의 **같은 기본값**이다 — 둘이 갈리면 설정을 고쳐도
     * 어떤 경로에서는 옛 값으로 도니, `test/docs.test.mjs` 가 둘을 대조한다.
     */
    const limit = cfg.sessionActiveMin ?? 3
    if (quiet < limit) {
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
  /**
   * 🔴 **사람이 적은 재개지시도 추적기의 "할 일 없음"을 넘어선다.**
   *
   *   실측 (2026-09-28): 추적기 `_plan/_resume/07-실행추적.json` 은 9월 22일에 끝난
   *   프로그램의 것이고 10건 전부 `applied` 였다(`doneMark 9/9`). 그런데 그 세션에는
   *   실제로 남은 일이 많았다 — 상태의 정본이 JSON 에서 **계획서 본문**으로 옮겨갔고
   *   설정은 옛 JSON 을 가리키고 있었다. 게이트는 정직하게 `할 일이 없다` 라고 답했다.
   *
   *   그때 화면은 "설정 탭에서 재개지시를 넣어라"라고 안내하는데, 예전에는 **그렇게 해도
   *   막혔다** — 추적기가 있으면 잘린 자리만 그 규칙을 넘었기 때문이다. 안내대로 해도
   *   안 되는 화면은 고장난 화면과 같다.
   *
   *   계획표는 **기계의 장부**이고 재개지시는 **사람이 직접 내린 지시**다. 사람이 적어 넣은
   *   것이 낡은 장부보다 우선한다 — 장부가 정본이 아니게 된 경우가 바로 이것이다.
   */
  const humanPoint = !!target.resumePrompt
  const cutPoint = limitStopped || interrupted || humanPoint

  if (hasTracker) {
    if (tracker.error && !cutPoint) return no(GATE.tracker, `추적기를 읽을 수 없다 — ${tracker.error}`)
    if (!tracker.error && !tracker.doing && !tracker.nextTodo && !cutPoint) {
      return no(GATE.tracker, tracker.allDone
        ? `할 일이 없다 (${tracker.doneMark} 전부 done) — 이어서 할 것이 있으면 설정 탭에 재개지시를 넣어라`
        : '추적기에 doing 도 todo 도 없다 — 재개 지점을 말해주지 않는다')
    }
  } else if (!cutPoint) {
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
      // 사실을 남긴다 — 프로세스가 살아 있든 아니든 '그 세션은 답을 마치고 멈춰 있었다'
      + ' · 세션은 사람을 기다리는 상태였다(도구 0 · 마지막 차례 모델)',
  }
}
