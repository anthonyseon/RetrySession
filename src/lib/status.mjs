/**
 * status.mjs — 화면과 CLI 가 함께 쓰는 상태 집계. 여기서만 모은다.
 *
 * 왜 한 곳인가
 *   같은 판정을 UI 와 CLI 가 따로 쓰면 둘이 서로 다른 답을 하게 된다. 감시 장치가
 *   창구마다 다른 말을 하면 신뢰할 수 없다 — 그래서 집계는 이 파일 하나다.
 *
 * 출처 경계 (실측으로 확인)
 *   CLI `claude agents --json`      → 실행 중 세션·pid  (사람이 쓰고 있나의 정답)
 *   CLI `claude auth status --json` → 계정·구독
 *   트랜스크립트                     → 토큰·비용·제목·할당량
 *   state/                          → 감시 기록 · 재시작 이력 · 등록부
 *   schtasks                        → OS 예약 등록 여부
 */
import { readFileSync } from 'node:fs'
import { localStamp, dayKey } from './stamp.mjs'
import { readTracker } from './tracker.mjs'
import { gitState } from './probe.mjs'
import { heartbeatVerdict, loadRunState, budgetVerdict } from './guard.mjs'
import { scanSessions } from './sessions.mjs'
import { runningSessions, account, cliVersion } from './cli.mjs'
import { loadTargets, statePaths, resolveRepo, trackerPath } from './targets.mjs'
import { taskState, taskEntries } from './scheduler.mjs'
import { sessionView } from './session-view.mjs'
import { ideWindows, findWindow, sessionsByFolder } from './ide.mjs'
import { claudeProcesses } from './procs.mjs'
import { allLockState } from './single.mjs'
import { currentAlerts, recentAlerts } from './alerts.mjs'
import { paths as repoPaths } from './config.mjs'
import { totalCost } from './pricing.mjs'
import { pcState } from './pc.mjs'
// 보기 변환은 view.mjs 로 옮겼다. tail 은 바깥(server.mjs)에서도 쓰므로 다시 내보낸다.
import { tail, quotaView } from './view.mjs'
export { tail, quotaView }

/* ── 전체 ────────────────────────────────────────────────────── */

/** 화면 한 장에 필요한 모든 것. */
export function fullStatus() {
  const registry = loadTargets()
  const scan = scanSessions()
  /**
   * 🔴 여기는 **보여주기용**이다. 판정용과 캐시 수명을 다르게 잡는다.
   *
   *   실측 (2026-09-22): 이 호출 하나가 1.0초이고 동기다 — 그동안 서버의 이벤트
   *   루프가 멈춘다. 화면이 3초마다 부르면 1분에 12초를 그렇게 쓴다. 그 사이
   *   아무것도 계산하지 않는 /api/ping 까지 같이 느려진다(.ps1 들이 5초로 판정한다).
   *   화면에 "N초 전 갱신"이 적혀 있으므로 15초 묵은 값은 거짓말이 아니다.
   *
   *   판정(resume.mjs)은 `ttlMs: 0` 으로 **매번 새로** 읽는다. 사람이 쓰는 대화에
   *   끼어들지 않으려면 그쪽은 묵은 값을 쓰면 안 된다.
   */
  const run = runningSessions({ ttlMs: 15000 })
  const runMap = new Map(run.sessions.map((s) => [s.sessionId, s]))

  // CLI 가 아는데 트랜스크립트에 아직 없는 세션(방금 시작)도 목록에 넣는다
  const seen = new Set(scan.sessions.map((s) => s.sessionId))
  const extra = run.sessions
    .filter((r) => !seen.has(r.sessionId))
    .map((r) => ({
      sessionId: r.sessionId, slug: null, title: r.name,
      cwdStart: r.cwd, cwdLatest: r.cwd, mainCwd: r.cwd,
      cwdTop: [{ path: r.cwd, entries: 0 }], cwdDist: {},
      gitBranch: null, version: null, firstAt: r.startedAtEpoch, lastAt: r.startedAtEpoch,
      userMsgs: 0, assistantMsgs: 0, toolCalls: 0, byModel: {}, quota: null,
      bytes: 0, activeMin: +((Date.now() - r.startedAtEpoch) / 60000).toFixed(1), tokenSum: 0,
    }))

  const ide = ideWindows()
  // 같은 이유로 프로세스 목록도 보여주기용 수명을 쓴다 (실측 0.7초, 동기)
  const procs = claudeProcesses({ ttlMs: 15000 })
  const procMap = new Map(procs.items.map((p) => [p.pid, p]))
  const sessions = [...scan.sessions, ...extra]
    .map((s) => sessionView(s, registry, runMap, ide.windows, procMap, run.ok))

  /**
   * 🔴 세션 행에 짝지어지지 않은 claude.exe — "목록에 없는 것"의 정체다.
   *
   * 실측: `claude agents --json` 이 2개를 보고할 때 실제로는 4개가 돌고 있었다.
   * 나머지 둘은 `--claude-in-chrome-mcp` 보조라 세션이 아닌 게 맞았지만,
   * CLI 만 믿었으면 그 존재조차 몰랐다. 무엇이 돌고 있는지는 전부 보여주고,
   * 세션이 아닌 것은 그렇다고 적는다.
   */
  const pairedPids = new Set(sessions.map((s) => s.pid).filter(Boolean))
  const orphanProcs = procs.items.filter((p) => !pairedPids.has(p.pid))

  /**
   * 열린 폴더별 세션 수 — "왜 이 폴더의 세션이 목록에 없나"에 답하기 위한 것이다.
   *
   * 실측 사례: Description 은 VS Code 에 폴더로 열려 있고 작업도 그곳에서 했지만,
   * `~/.claude/projects/<Description 슬러그>/` 에는 트랜스크립트(.jsonl)가 0개였다.
   * 그 폴더에서 Claude Code 를 **시작한** 적이 없고, 세션은 EasyAI.Platform 에서
   * 시작해 Description 으로 옮겨가 일했을 뿐이다. 세션 목록만 보면 이 차이를
   * 설명할 수 없으므로 열린 폴더를 나란히 놓는다.
   */
  const folders = sessionsByFolder(ide.windows, sessions)

  const acct = account()
  const totalTokens = sessions.reduce((a, s) => a + s.tokenSum, 0)
  const totalUSD = +sessions.reduce((a, s) => a + s.costUSD, 0).toFixed(2)
  /**
   * 오늘(로컬) 합계. 🔴 반올림은 **합한 뒤 한 번만** 한다 — 세션마다 반올림해서 더하면
   *   세션 수만큼 오차가 쌓인다(CLAUDE.md 「금액을 다룰 때」).
   */
  const todayTokens = sessions.reduce((a, s) => a + (s.todayTokenSum || 0), 0)
  const todayUSD = +sessions.reduce((a, s) => a + (s.todayCostUSD || 0), 0).toFixed(2)
  const locks = allLockState()

  const fallback = {
    at: localStamp(),
    atEpoch: Date.now(),
    account: acct,
    cli: { version: cliVersion(), agentsQuery: { ok: run.ok, error: run.error } },
    quota: quotaView(scan.quota),
    // PC 전원 설정 — 잠든 PC 는 아무것도 돌리지 않는다. 읽기가 느려서(474ms 실측)
    // 60초 캐시를 쓴다(lib/pc.mjs). 사람이 바꾸기 전에는 그대로이므로 무해하다.
    pc: pcState(),
    tasks: taskState(),
    ide: {
      windows: ide.windows,
      error: ide.error,
      liveWindows: ide.windows.filter((w) => w.alive).length,
      staleLocks: ide.windows.filter((w) => w.stale).length,
      folders,
    },
    processes: {
      ok: procs.ok,
      error: procs.error,
      items: procs.items,
      sessionCount: procs.sessionCount,
      helperCount: procs.helperCount,
      orphans: orphanProcs,
      // CLI 가 보고한 세션 수와 실제 세션형 프로세스 수가 다르면 그 자체가 정보다
      mismatch: procs.ok && procs.sessionCount !== sessions.filter((s) => s.running).length,
    },
    sessions,
    totals: {
      sessionCount: sessions.length,
      running: sessions.filter((s) => s.running).length,
      // 🔴 조회가 실패했으면 "0개 실행 중"이 아니라 "모른다"다. 화면이 이 값을 보고 구별한다.
      runKnown: run.ok,
      runQueryError: run.ok ? null : run.error,
      watchOn: sessions.filter((s) => s.watch.on).length,
      restartOn: sessions.filter((s) => s.restart.on).length,
      // 열려 있지만 그 폴더에서 시작된 세션이 없는 곳 — 목록에 "없어 보이는" 이유다
      foldersNoSession: folders.filter((f) => f.startedHere === 0).length,
      claudeProcs: procs.items.length,
      bypassSessions: sessions.filter((s) => s.processes?.riskyPerm).length,
      totalTokens,
      totalUSD,
      todayTokens,
      todayUSD,
      // 어느 날짜를 "오늘"로 셌는지 — 자정을 넘긴 화면이 어제 숫자를 오늘이라 말하지 않게
      todayKey: dayKey(),
      // 🔴 구독(max)이면 정가 환산은 청구액이 아니다. 화면이 이 문장을 그대로 보여준다.
      costNote: acct.isSubscription
        ? `정가 환산 참고값 — 구독(${acct.subscriptionType})이므로 실제 청구액이 아니다`
        : '정가 기준 환산액',
    },
    locks,
    scan: scan.scan,
  }

  /**
   * 경보는 나머지가 다 모인 뒤에 판정한다 — 세션·작업·할당량·락을 모두 본다.
   * 🔴 판정은 alerts.mjs 하나다. 화면이 따로 계산하면 트레이·로그와 말이 갈라진다.
   */
  const alerts = currentAlerts(fallback)
  return {
    ...fallback,
    alerts,
    alertHistory: recentAlerts(60),
    totals: {
      ...fallback.totals,
      alerts: alerts.length,
      criticalAlerts: alerts.filter((a) => a.level === 'critical').length,
    },
  }
}

/**
 * 트레이 아이콘용 요약. **키가 전부 ASCII 다.**
 *
 * 🔴 왜 따로 있나
 *   `scripts/tray.ps1` 은 ASCII 여야 한다(PowerShell 5.1 이 ANSI 로 읽는다). 그런데
 *   fullStatus() 의 속성명은 한글이라 그 스크립트가 코드에 적을 수 없다.
 *   그래서 ASCII 키로 갈아 담은 창구를 하나 둔다.
 *
 * 🔴 판정(`kind`)도 여기서 한다 — 트레이가 따로 계산하면 화면과 트레이가
 *   서로 다른 말을 하게 된다. 집계는 한 곳이라는 규칙을 지킨다.
 *
 * @returns {{kind:'good'|'warn'|'crit'|'off', ...}}
 */
export function trayStatus() {
  const d = fullStatus()
  const sessions = d.sessions

  const dead = sessions.filter((s) => s.watch.on && s.watch.verdict && !s.watch.verdict.alive).length
  const blocked = sessions.filter((s) => s.restart.on && s.restart.blocked).length
  const watched = d.totals.watchOn
  const limited = !!(d.quota.exists && !d.quota.alreadyLifted)
  const unregisteredTasks = taskEntries(d.tasks).filter(([, v]) => v.registered === false).length

  // 실행 여부를 모르면 자율 재개가 멈춘 상태다(fail-closed). 조용히 넘기면 안 된다.
  const unknownRun = d.totals.runKnown === false

  // 나쁜 것이 먼저다 — 가장 급한 하나를 아이콘이 나른다
  let kind = 'good', state = 'ok'
  if (dead > 0) { kind = 'crit'; state = 'stalled' }
  else if (unknownRun) { kind = 'crit'; state = 'unknown' }
  else if (blocked > 0) { kind = 'crit'; state = 'blocked' }
  else if (limited) { kind = 'warn'; state = 'limited' }
  else if (watched === 0) { kind = 'off'; state = 'none' }

  return {
    kind, state,
    at: d.at,
    sessions: d.totals.sessionCount,
    running: d.totals.running,
    // 🔴 running:0 과 "모른다"는 다르다. ASCII 키 — tray.ps1 이 코드에 적는다.
    runningKnown: !unknownRun,
    watched,
    resumeOn: d.totals.restartOn,
    dead, blocked, limited,
    unregisteredTasks: unregisteredTasks,
    limitText: d.quota.desc || '',
    account: d.account.email || '',
    plan: d.account.subscriptionType || '',
    // 트레이는 개수만 보여준다 — 내용과 조치는 화면에서 한다(풍선 알림 없음)
    alerts: d.totals.alerts || 0,
    criticalAlerts: d.totals.criticalAlerts || 0,
  }
}
