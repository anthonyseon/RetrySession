/**
 * session-view.mjs — **세션 하나**의 보기 상태. 감시·재시작·추적기·재개 판정을 한 덩이로.
 *
 * 🔴 왜 status.mjs 에서 떼어냈나
 *   status.mjs 가 420줄이 되어 400줄 규칙을 넘겼다. 자를 자리는 여기가 맞다 —
 *   위쪽은 "세션 하나를 어떻게 볼 것인가"이고 아래쪽(fullStatus·trayStatus)은
 *   "전부를 어떻게 합칠 것인가"다. 한 세션의 판정을 고치러 온 사람이 합계 코드를
 *   함께 넘겨야 할 이유가 없다.
 *
 * 🔴 판정은 여기서 하지 않는다. guard.mjs · resume-gate.mjs 가 정하고 여기는 **옮긴다.**
 *   화면과 CLI 가 같은 말을 하려면 판정이 한 곳에 있어야 한다.
 */
import { readFileSync } from 'node:fs'
import { localStamp, dayKey } from './stamp.mjs'
import { readTracker } from './tracker.mjs'
import { gitState } from './probe.mjs'
import { heartbeatVerdict, loadRunState, budgetVerdict } from './guard.mjs'
import { statePaths, resolveRepo, trackerPath } from './targets.mjs'
import { resumeGate } from './resume-gate.mjs'
import { findWindow } from './ide.mjs'
import { totalCost } from './pricing.mjs'
import { tail } from './view.mjs'
/* ── 세션 하나의 감시·재시작 상태 ────────────────────────────── */

/**
 * @param runKnown 실행 중 목록 조회가 성공했는가. false 면 "정지"라고 말할 수 없다.
 */
export function sessionView(s, registry, runMap, ideWins = [], procMap = new Map(), runKnown = true) {
  const run = runMap.get(s.sessionId) || null
  const target = registry.targets[s.sessionId] || null

  /**
   * 🔴 세션의 cwd 는 하나가 아니다(실측). 셋을 구별해 쓴다:
   *   실행cwd — 프로세스를 띄운 자리. CLI 가 말해주는 값이 정답이고, 재시작을 여기서 띄운다.
   *   주작업cwd — 가장 많이 머문 곳. 무엇을 하던 세션인가이고, 저장소·추적기 짝짓기는 이쪽이다.
   *   최근cwd — 마지막으로 있던 곳. 중단 지점의 단서다.
   */
  const runCwd = run?.cwd || s.cwdStart || s.mainCwd || null
  const pairCwd2 = s.mainCwd || s.cwdLatest || runCwd
  const { project, hasConfig } = pairCwd2 ? resolveRepo(pairCwd2) : { project: null, hasConfig: false }
  const P = target ? statePaths(s.sessionId) : null

  /* 감시 */
  let watchView = { on: !!target?.watch, hasRecord: false, verdict: null, lastRecord: null }
  if (P) {
    let hb = null
    try { hb = JSON.parse(readFileSync(P.heartbeat, 'utf8')) } catch { hb = null }
    const limit = project?.heartbeat?.staleLimitMin ?? 15
    /**
     * 감시를 켠 시각. 이것이 있어야 "첫 기록 대기"와 "끊김"을 가를 수 있다.
     * 옛 등록부에는 epoch 이 없으므로 문자열 시각으로 물러선다(없으면 null).
     */
    const onEpoch = typeof target.watchOnEpoch === 'number'
      ? target.watchOnEpoch
      : (Date.parse(target.updatedAt || target.addedAt || '') || null)
    watchView = {
      on: !!target.watch,
      hasRecord: !!hb,
      verdict: target.watch ? heartbeatVerdict(hb, limit, Date.now(), onEpoch) : null,
      limitMin: limit,
      lastRecord: hb ? { at: hb.at, step: hb.stage?.id, done: hb.stage?.doneStages } : null,
      log: tail(P.hbLogPath, 12),
    }
  }

  /* 재시작 */
  let resumeView = { on: !!target?.restart }
  if (P && project) {
    const st = loadRunState(P.resumeState)
    const b = budgetVerdict(st, project.resume)
    resumeView = {
      on: !!target.restart,
      permissionMode: project.resume.permissionMode,
      runsToday: b.runsToday,
      maxPerDay: project.resume.maxPerDay,
      costToday: b.costToday,
      maxCostUSDPerDay: project.resume.maxCostUSDPerDay ?? null,
      failStreak: st.failStreak || 0,
      failStreakMax: project.resume.failStreakMax,
      /**
       * 오늘 API 과부하로 막힌 횟수. 연속실패로는 안 세지만(차단기를 태우지 않는다)
       * **몇 번이나 막혔는지는 보여야 한다** — 조용히 넘기면 "왜 아무 일도 안 일어나지"가
       * 또 안 보인다. 잦아지면 경보로 올린다(alerts.mjs).
       *
       * 🔴 `dayKey` 를 쓴다. `toISOString().slice(0,10)` 은 **UTC** 라서 Asia/Seoul 에서는
       *   하루 중 9시간 동안 없는 날짜를 찾는다 — 세어 놓고도 늘 0 으로 보인다.
       *   기록하는 쪽(guard.recordRun)이 dayKey 로 쓰므로 읽는 쪽도 같아야 한다.
       */
      overloadToday: (st.overloadByDay || {})[dayKey()] || 0,
      /** 오늘 로그인이 끊겨 재개가 헛돈 횟수. 위와 같은 이유로 보여준다(차단은 안 한다) */
      authToday: (st.authByDay || {})[dayKey()] || 0,
      /**
       * 오늘 타임아웃으로 **잘린** 횟수. 차단하지 않는 대신 세어서 보여준다.
       * 🔴 한 번이 타임아웃분을 통째로 먹으므로(30~60분) 과부하보다 적은 횟수에서 말한다.
       */
      timeoutToday: (st.timeoutByDay || {})[dayKey()] || 0,
      /** 우리가 띄운 CLI 가 낡아 튕긴 횟수 — 고치기 전까지 재개는 한 번도 못 돈다 */
      outdatedToday: (st.outdatedByDay || {})[dayKey()] || 0,
      blocked: st.blocked || null,
      corrupt: st.corrupt || null,
      budgetOk: b.ok,
      budgetWhy: b.why,
      lastRun: st.lastRun || null,
      log: tail(P.resumeLogPath, 24),
    }
  }

  /* 추적기 — 재시작 지점의 근거 */
  let tracker = { exists: false }
  if (project) {
    const tp = trackerPath(project)
    if (tp) {
      const t = readTracker(tp)
      tracker = {
        exists: true, path: project.tracker, doneMark: t.doneMark, allDone: t.allDone,
        doing: t.doing, nextTodo: t.nextTodo, doingViolations: t.doingViolations,
        nextAction: t.nextAction, error: t.error,
        /**
         * 🔴 **언제 바뀐 파일인가.** 읽기는 늘 최신이지만(캐시 없음) 파일 자체가 며칠째
         *   그대로일 수 있다 — 그러면 `9/9` 가 「진행 중」으로 오해된다. 갱신은 재개된
         *   세션이 하고, RetrySession 은 이 파일을 쓰지 않는다.
         */
        fileAt: t.fileAt || null, fileAgeMin: t.fileAgeMin ?? null,
      }
    } else if (project.tracker) {
      tracker = { exists: false, path: project.tracker, desc: '설정에 경로는 있는데 파일이 없다' }
    }
  }

  /**
   * 🔴 **지금 재개하면 되나** — 재개가 15분 뒤에 내릴 그 판정을 지금 보여준다.
   *
   *   실측 결함 (2026-09-22): 화면은 예산만 보고 "재시작 준비"라고 말했는데, 실제로는
   *   여덟 가지가 더 막았다(실행 중·재개 지점 없음·저장소 잠금·조용한 시간…).
   *   그래서 켜 놓고 "왜 안 도나"를 반복해서 묻게 됐다. **없는 것을 있다고 말한 것이다.**
   *   판정은 lib/resume-gate.mjs 하나뿐이고 재개도 같은 것을 쓴다 — 창구마다 다른 말을
   *   하지 않는다.
   *
   *   순수 함수라 공짜다(파일·프로세스를 건드리지 않는다). 재시작을 켠 대상만 본다.
   */
  if (target?.restart && P) {
    resumeView.gate = resumeGate({
      target, project, state: loadRunState(P.resumeState), quota: null,
      /**
       * 🔴 화면도 재개와 **같은 재료**로 판정한다. pid 는 넘기지 않는다 —
       *   "프로세스가 살아 있다"는 "사람이 그 세션을 쓰고 있다"가 아니었고,
       *   그 오해가 560회 연속 건너뜀을 만들었다(resume-gate 의 주석).
       */
      session: {
        activeMin: s.activeMin, openTools: s.openTools, lastKind: s.lastKind,
        stoppedByLimit: s.stoppedByLimit, stoppedByInterrupt: s.stoppedByInterrupt, quota: s.quota,
      },
      tracker,
    })
  }

  const cost = totalCost(s.byModel)

  return {
    sessionId: s.sessionId,
    shortId: s.sessionId.slice(0, 8),
    slug: s.slug,
    runCwd,
    mainCwd: s.mainCwd || null,
    cwdRecent: s.cwdLatest || null,
    cwdTop: s.cwdTop || [],
    multiRepo: (s.cwdTop || []).length > 1,
    title: s.title || run?.name || null,
    cliName: run?.name || null,
    gitBranch: s.gitBranch,
    cliVer: s.version,

    /**
     * 🔴 "정지"와 "모름"은 다르다.
     *
     *   실측 결함 (2026-09-21): `runningSessions()` 의 ok 를 보지 않고 목록만 썼다.
     *   CLI 조회가 실패하면 목록이 비어서 **모든 세션이 조용히 '정지'로** 보였다 —
     *   화면에도, 하트비트 기록에도, 트레이 개수에도. 조회 실패는 `agents조회` 에
     *   담기고 있었지만 **아무도 읽지 않았다.**
     *   resume.mjs 에서 고친 것과 같은 부류다(guard.mjs 의 세션실행중 참조).
     *   모를 때는 모른다고 말한다.
     */
    running: runKnown ? !!run?.alive : false,
    runKnown: runKnown,
    pid: run?.pid ?? null,
    kind: run?.kind ?? null,
    startedAt: run?.startedAtEpoch ? localStamp(new Date(run.startedAtEpoch)) : null,

    /**
     * 사용량 제한에 잘려 멈춰 있나 — 재개가 이것을 재개 지점으로 인정한다.
     * '제한을 겪었다'가 아니라 '마지막 엔트리가 제한 알림이다' 이다(sessions.mjs).
     */
    stoppedByLimit: !!s.stoppedByLimit,
    limitNoticeTime: s.limitNoticeAt ? localStamp(new Date(s.limitNoticeAt)) : null,

    /**
     * 응답이 끝까지 오지 못하고 끊긴 자리 (절전·네트워크 멎음). 재개 지점으로 인정한다.
     * 화면에도 보여야 한다 — 사람이 "왜 여기서 멈췄지"를 묻는 바로 그 상태다.
     */
    stoppedByInterrupt: !!s.stoppedByInterrupt,
    interruptNoticeTime: s.interruptNoticeAt ? localStamp(new Date(s.interruptNoticeAt)) : null,

    lastAt: s.lastAt ? localStamp(new Date(s.lastAt)) : null,
    activeMin: s.activeMin,
    firstAt: s.firstAt ? localStamp(new Date(s.firstAt)) : null,

    /**
     * 🔴 **판정의 재료를 응답에 함께 싣는다** — "쓰는 중인가"를 정하는 값들이다.
     *   실측 (2026-09-28, 전수 재검증): 판정은 이 값들로 `작업중` 을 정확히 말하는데,
     *   응답에는 `undefined` 로 비어 있었다. 화면·진단이 **판정의 근거를 볼 수 없다**는 뜻이고,
     *   그러면 "왜 작업중이라는 거지"를 확인하려고 트랜스크립트를 다시 읽어야 한다.
     *   값만 있고 근거가 없으면 판단할 수 없다 — 이 저장소가 요약 타일에서 이미 고친 것이다.
     */
    openTools: s.openTools ?? null,
    lastKind: s.lastKind ?? null,

    userMsgs: s.userMsgs,
    assistantMsgs: s.assistantMsgs,
    toolCalls: s.toolCalls,
    tokenSum: s.tokenSum,
    costUSD: cost.usd,
    costHasEstimate: cost.hasEstimate,
    byModel: cost.byModel,
    bytes: s.bytes,

    /**
     * 오늘(로컬) 몫 — 누적과 **나란히** 보여준다.
     * 스캔이 이미 계산해 뒀다(`lib/sessions.mjs` 의 오늘 통). 여기서 다시 세지 않는다 —
     * 두 곳에서 세면 반드시 어긋나고, 어긋난 숫자는 둘 다 못 믿게 된다.
     */
    todayKey: s.todayKey || null,
    todayTokenSum: s.todayTokenSum || 0,
    todayCostUSD: s.todayCostUSD || 0,
    todayByModel: s.todayByModel || {},
    todayUserMsgs: s.todayUserMsgs || 0,
    todayAssistantMsgs: s.todayAssistantMsgs || 0,
    todayToolCalls: s.todayToolCalls || 0,

    // 이 세션이 어느 VS Code 창에서 열린 폴더에 있나 (살아있는 창만)
    ide: findWindow(runCwd, ideWins) || findWindow(pairCwd2, ideWins),

    /**
     * 실제 프로세스. `claude agents --json` 이 주는 pid 로 짝짓는다.
     * 여기서만 알 수 있는 것: 어느 바이너리인지(VS Code 확장 vs npm), 권한 우회 여부,
     * --add-dir 로 붙은 폴더. 특히 권한 우회는 사람이 알아야 한다.
     */
    processes: run?.pid ? (procMap.get(run.pid) || null) : null,

    registered: !!target,
    resumePrompt: target?.resumePrompt || null,
    hasRepoConfig: hasConfig,
    repoId: project?.id || null,
    watch: watchView,
    restart: resumeView,
    tracker,
    // git 조회는 프로세스를 띄운다 — 감시를 켠 대상만 본다
    git: pairCwd2 && target?.watch ? gitState(pairCwd2) : null,
  }
}
