/**
 * resume.mjs — 세션 바깥에서 **실제로 일을 재개시킨다.**
 *
 * 이 파일이 메우는 비대칭
 *   하트비트는 "어디서 멈췄는지"를 바깥에 적어두는 장치일 뿐이다. 기록은 남지만 일은
 *   재개되지 않는다. 원본 계획에서는 재개를 세션 안 예약(cron)이나 사람이 해야 했고,
 *   세션이 닫히면 둘 다 멈췄다 — 그것이 유일하게 남은 정지 요인이었다.
 *   여기서는 OS 작업 스케줄러가 `claude --resume <sessionId> -p` 를 띄운다.
 *
 * 🔴 왜 --resume 인가 (새 세션을 만들지 않는다)
 *   실측: `claude --resume <id> -p` 는 헤드리스로 돌고 **문맥을 유지한다**(직전 요청을
 *   정확히 회상했고, 응답의 session_id 가 재개한 id 와 같았다 — 갈라지지 않는다).
 *   새 `claude -p` 로 띄우면 그 세션이 무엇을 하던 중인지 처음부터 설명해야 하고,
 *   캐시도 새로 잡혀 더 비싸다.
 *
 * 🔴 인증은 VS Code 에 로그인된 계정을 쓴다. API 키를 쓰지 않는다 (lib/cli.mjs 의 계정환경).
 *
 * 🔴 사람이 보고 있지 않은 실행이다. 가드를 먼저 통과해야 한다 — 싼 것부터 순서대로:
 *   ① 등록  ①' 저장소 잠금(resume.enabled)  ② 조용한 시간  ③ 세션이 실행 중인가(pid)
 *   ④ 최근 활동  ⑤ 재개 지점이 있나(추적기·재개지시·제한중단·끊김)  ⑥ 예산  ⑦ 락
 *   하나라도 막히면 이유를 로그에 적고 exit 0 으로 끝낸다 — 스케줄러가 실패로 보지 않게.
 *   같은 이유가 이어지면 로그는 **접는다**(logSkip) — 안 읽는 기록은 없는 것과 같다.
 *
 * 🔴 실패라고 다 우리 실패가 아니다. 사용량 제한(limited)과 API 과부하(overload)는
 *   연속실패로 세지 않는다 — 기다리면 풀릴 일에 회로를 차단하면 사람 손을 부른다.
 *
 * 사용법
 *   node src/resume.mjs              가드 통과 시 재개 (스케줄러가 부르는 것)
 *   node src/resume.mjs --dry-run    가드만 판정하고 띄우지 않는다 (지시문도 보여준다)
 *   node src/resume.mjs --status     예산·마지막 실행 상태
 *   node src/resume.mjs --rearm      회로 차단·연속실패 해제
 *   node src/resume.mjs --force      조용한시간·활동·예산 무시 (실행 중 확인과 락은 지킨다)
 */
import { localStamp } from './lib/stamp.mjs'
import { appendLine, appendOrFold } from './lib/io.mjs'
import { readTracker } from './lib/tracker.mjs'
import { buildPrompt } from './lib/prompt.mjs'
import {
  loadRunState, saveRunState, budgetVerdict, recordRun,
  acquireLock, releaseLock, quietNow, sessionRunning, limitState, isLimitFailure, isTransientFailure,
} from './lib/guard.mjs'
import { loadTargets, statePaths, resolveRepo, trackerPath, isSessionId } from './lib/targets.mjs'
import { runningSessions, isAlive } from './lib/cli.mjs'
import { runClaude, parseResult } from './lib/claude-run.mjs'
import { resumeGate } from './lib/resume-gate.mjs'
import { printStatus, doRearm } from './lib/resume-report.mjs'
import { scanSessions } from './lib/sessions.mjs'
import { singleInstance } from './lib/single.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const DRY = flag('--dry-run'), FORCE = flag('--force')

const log = (P, line) => { try { appendLine(P.resumeLogPath, line) } catch { /* 로그 실패로 재개를 막지 않는다 */ } }

/**
 * 건너뛴 이유를 적되, **같은 이유가 이어지면 접는다.**
 *
 * 🔴 실측 (2026-09-22): 15분마다 똑같은 `SKIP · 세션이 실행 중이다 (pid 4084)` 가 쌓여
 *   21회차가 전부 같은 줄이었다. 사람이 열면 스무 줄을 넘겨야 달라진 한 줄에 닿는다 —
 *   그러면 로그를 안 읽게 되고, **안 읽는 기록은 없는 것과 같다.**
 *   줄이는 게 아니라 접는다: 횟수와 처음 시각이 남아 "언제부터 이러고 있나"를 말해 준다.
 */
const logSkip = (P, why) => {
  const at = localStamp()
  try {
    appendOrFold(P.resumeLogPath, {
      sameKey: ` · ${why}`,
      line: `${at} · SKIP · ${why}`,
      folded: ({ count, firstAt }) => `${at} · SKIP ×${count} (처음 ${firstAt}) · ${why}`,
    })
  } catch { /* 로그 실패로 재개를 막지 않는다 */ }
}

function pickTargets() {
  const t = loadTargets()
  const one = opt('--session')
  let list = Object.entries(t.targets).map(([id, v]) => ({ sessionId: id, ...v }))

  // 형태가 아닌 id 는 경로가 될 수 없다. 조용히 버리지 않고 알린 뒤 건너뛴다 —
  // 한 줄이 이상하다고 나머지 대상까지 못 돌게 하면 그게 더 나쁘다.
  const bad = list.filter((x) => !isSessionId(x.sessionId))
  if (bad.length) {
    console.warn(`⚠ 등록부에 세션 id 형태가 아닌 항목이 ${bad.length}개 있다 — 건너뛴다: ` +
      bad.map((x) => JSON.stringify(String(x.sessionId).slice(0, 40))).join(', '))
    list = list.filter((x) => isSessionId(x.sessionId))
  }

  if (one) list = list.filter((x) => x.sessionId === one || x.sessionId.startsWith(one))
  else list = list.filter((x) => x.restart)
  return list
}

/* ── 가드 ────────────────────────────────────────────────────── */

function verdict(target, ctx) {
  const P = statePaths(target.sessionId)
  const pairCwd2 = target.mainCwd || target.runCwd
  const { project } = pairCwd2 ? resolveRepo(pairCwd2) : { project: null }
  const state = loadRunState(P.resumeState)
  const s = ctx.sessionMap.get(target.sessionId)
  const tp = project ? trackerPath(project) : null

  /**
   * 🔴 판정 자체는 **lib/resume-gate.mjs 한 곳에** 있다.
   *   화면도 같은 함수로 같은 답을 낸다 — 예전에는 화면이 예산만 보고 "재시작 준비"라
   *   말했고, 실제로는 여덟 가지가 더 막아 15분마다 조용히 건너뛰었다.
   *   규칙을 두 벌 만들면 창구마다 다른 말을 한다.
   */
  const g = resumeGate({
    target, project, state, session: s, quota: ctx.quota, force: FORCE,
    running: sessionRunning(ctx.running, target.sessionId, isAlive),
    tracker: tp ? { exists: true, ...readTracker(tp) } : { exists: false },
  })
  return { ...g, P, project, state, limitStopped: !!s?.stoppedByLimit, interrupted: !!s?.stoppedByInterrupt }
}

/* ── 부속 명령 ───────────────────────────────────────────────── */

if (flag('--status')) { printStatus(); process.exit(0) }

if (flag('--rearm')) { process.exit(doRearm(pickTargets(), { picked: !!opt('--session') }) ? 0 : 1) }

/* ── 본 실행 ─────────────────────────────────────────────────── */

/**
 * 🔴 재시작은 프로세스 단위로도 하나만 돈다.
 *   세션별 락은 같은 세션을 두 번 미는 것만 막는다. 프로세스가 둘이면 서로 다른
 *   세션을 동시에 밀어 하루 예산을 두 배로 쓰고, 워킹트리가 겹치면 편집이 충돌한다.
 *   한 회차는 최대 타임아웃(기본 30분)이므로 90분을 넘겼다면 죽은 락으로 본다.
 */
singleInstance('resume', { staleMin: 90 })

const items = pickTargets()
if (!items.length) {
  console.log(`재시작 ${localStamp()} — 대상이 없다. UI 에서 세션을 골라 재시작을 켜라.`)
  process.exit(0)
}

/**
 * 🔴 "실행 중인가"를 **모르면 재개하지 않는다.**
 *
 *   결함이었다: 예전에는 `runningSessions()` 의 `ok` 를 보지 않고 `sessions` 만 썼다.
 *   CLI 호출이 실패하면(claude 가 없거나·타임아웃·JSON 이 아님) 그 목록은 **빈 배열**이
 *   되고, 그러면 모든 세션이 "안 돌고 있다"로 보여 판정 ③번 관문이 통째로 열린다.
 *   사람이 쓰고 있는 대화에 `--resume` 을 밀어넣게 되는데, 그 관문은 이 파일이
 *   `--force` 로도 못 건너뛴다고 못박은 바로 그 관문이다.
 *   목록이 없는 것과 "아무도 안 돈다"는 다르다. 모르면 멈춘다.
 */
const readRunning = () => runningSessions({ ttlMs: 0 })   // 판정용이라 캐시를 쓰지 않는다

const firstRead = readRunning()
if (!firstRead.ok) {
  console.error(`⛔ 실행 중 세션을 확인할 수 없다 — ${firstRead.error}`)
  console.error('   모르는 채로 밀면 사람이 쓰는 대화에 끼어든다. 이번 회차는 건너뛴다.')
  for (const target of items) {
    log(statePaths(target.sessionId), `${localStamp()} · SKIP · 실행 중 여부를 확인할 수 없다 (claude agents --json 실패: ${firstRead.error})`)
  }
  process.exit(0)
}

const firstScan = scanSessions()
const ctx = {
  running: firstRead,
  sessionMap: new Map(firstScan.sessions.map((s) => [s.sessionId, s])),
  // 세션별 기록이 없을 때 쓰는 전체 할당량(가장 최근 것)
  quota: firstScan.quota,
  readAt: Date.now(),
}

let exitCode = 0

for (const target of items) {
  /**
   * 🔴 판정 직전에 다시 읽는다.
   *
   *   결함이었다: 두 맵을 루프 **밖에서 한 번만** 만들었다. 한 회차는 최대 30분이라
   *   (타임아웃분 기본값), 앞 세션을 미는 동안 사람이 다음 세션을 열었을 수 있다.
   *   그러면 30분 묵은 목록을 보고 "안 돌고 있다"고 판정해 --resume 을 밀어넣는다.
   *   한 대상이 끝날 때마다 시간이 흘렀으면 다시 읽는다 — 이 확인은 싸고(~0.7초),
   *   틀렸을 때의 대가는 사람과 같은 대화에 동시에 쓰는 것이다.
   */
  if (Date.now() - ctx.readAt > 60_000) {
    ctx.running = readRunning()
    const rescan = scanSessions()
    ctx.sessionMap = new Map(rescan.sessions.map((s) => [s.sessionId, s]))
    ctx.quota = rescan.quota
    ctx.readAt = Date.now()
    // 다시 읽다 실패하면 판정이 fail-closed 로 막는다(세션실행중) — 여기서 따로 뚫지 않는다
  }

  const v = verdict(target, ctx)
  const short = target.sessionId.slice(0, 8)

  if (!v.go) {
    logSkip(v.P, v.why)
    console.log(`⛔ ${short} 건너뜀 — ${v.why}`)
    continue
  }

  const prompt = buildPrompt(target, v.project, { limitStopped: v.limitStopped, interrupted: v.interrupted })

  if (DRY) {
    console.log(`✅ ${short} 재개 가능 — ${v.why}`)
    console.log('─── 넘길 지시문 ───')
    console.log(prompt)
    console.log('───────────────────')
    continue
  }

  const cfg = v.project.resume
  const lock = acquireLock(v.P.resumeLock, cfg.lockStaleMin ?? 60)
  if (!lock.ok) {
    log(v.P, `${localStamp()} · SKIP · ${lock.why}`)
    console.log(`⛔ ${short} 건너뜀 — ${lock.why}`)
    continue
  }

  try {
    const cwd = target.runCwd || v.project.repo
    log(v.P, [
      '', '═'.repeat(70),
      `${localStamp()} · RUN 시작 · ${v.why}`,
      `  --resume ${target.sessionId} · 권한 ${cfg.permissionMode} · 타임아웃 ${cfg.timeoutMin}분`,
      `  cwd ${cwd}`,
    ].join('\n'))
    console.log(`▶ ${short} 재개 — ${v.why}`)

    const r = await runClaude({
      sessionId: target.sessionId, cwd, prompt, cfg, addDirs: cfg.addDirs,
    })
    const p = parseResult(r.stdout)
    /**
     * 🔴 제한 때문에 막힌 것은 실패가 아니다.
     *   판정에서 미리 막지만(제한상태), 기록이 낡았거나 방금 걸렸으면 여기까지 온다.
     *   그때 실패로 세면 세 번 만에 회로가 차단된다 — 기다리면 될 일에. 뒷받침 장치다.
     */
    const didFail = r.timedOut || r.code !== 0 || !p.ok
    // 타임아웃은 제한도 과부하도 아니다 — 30분을 실제로 돌았다는 뜻이다
    const label = `${p.summary} ${r.stderr}`
    const limitBlocked = didFail && !r.timedOut && isLimitFailure(label)
    /**
     * 🔴 저쪽이 흔들린 것도 우리 실패가 아니다 (제한과 같은 이유).
     *   529·503 은 isLimitFailure 에 안 걸려 'fail' 로 세어졌고, 세 번이면 회로가
     *   차단됐다. 기다리면 될 일에 사람 손을 부르는 것은 제한에서 이미 고친 실수다.
     */
    const overloaded = didFail && !r.timedOut && !limitBlocked && isTransientFailure(label)
    const result = r.timedOut ? 'timeout'
      : !didFail ? 'ok'
      : limitBlocked ? 'limited'
        : overloaded ? 'overload' : 'fail'

    const next = recordRun(loadRunState(v.P.resumeState), {
      result, summary: p.summary, tookSec: r.tookSec, costUSD: p.costUSD,
      turns: p.turns, sid: p.sid, permDenied: p.permDenied, exit: r.code,
      // 같은 자리를 두 번 이어 밀지 않으려면 **무엇을 이어서** 띄웠는지 남아야 한다
      point: v.point,
    }, cfg)
    saveRunState(v.P.resumeState, next)

    log(v.P, [
      `${localStamp()} · RUN 끝 · ${result} · ${r.tookSec}초 · $${p.costUSD} · 턴 ${p.turns ?? '?'} · exit ${r.code}` +
        (p.permDenied ? ` · 권한거부 ${p.permDenied}건` : '') +
        (r.timedOut ? ' · 🔴 타임아웃으로 강제 종료' : ''),
      // 세션이 갈라졌는지 확인한다 — 같아야 정상이다
      p.sid && p.sid !== target.sessionId ? `  ⚠ 세션이 갈라졌다: ${p.sid}` : '',
      '  ── 요약 ──',
      (p.summary || '(없음)').split('\n').map((l) => '  ' + l).join('\n'),
      r.stderr.trim() ? '  ── stderr ──\n' + r.stderr.trim().split('\n').slice(-20).map((l) => '  ' + l).join('\n') : '',
      next.blocked ? `  🔴 연속 ${next.failStreak}회 실패로 회로 차단됨 — 고친 뒤 --rearm` : '',
    ].filter(Boolean).join('\n'))

    // 🔴 제한·과부하는 실패가 아니다 — 스케줄러 이력을 빨갛게 물들이지 않는다.
    //   가드에 막힌 회차가 exit 0 인 것과 같은 이유다. 때가 아닌 것이지 고장이 아니다.
    const notOurFault = result === 'limited' || result === 'overload'
    const shown = result === 'ok' ? '✅' : notOurFault ? '◔' : '✖'
    console.log(`${shown} ${short} — ${result} · ${r.tookSec}초 · $${p.costUSD}`)
    if (result !== 'ok' && !notOurFault) exitCode = 1
  } finally {
    releaseLock(v.P.resumeLock)
  }
}

process.exit(exitCode)
