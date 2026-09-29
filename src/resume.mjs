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
 *   node src/resume.mjs --force      기다리면 풀리는 것만 건너뛴다 — 아래 계약 참고
 *   node src/resume.mjs --now        판정을 건너뛰고 지금 띄운다 (화면의 지금 재시작 실행)
 */
import { localStamp } from './lib/stamp.mjs'
import { appendLine, appendOrFold } from './lib/io.mjs'
import { readTracker } from './lib/tracker.mjs'
import { buildPrompt } from './lib/prompt.mjs'
import {
  loadRunState, saveRunState, budgetVerdict, recordRun,
  acquireLock, releaseLock, quietNow, limitState,
} from './lib/guard.mjs'
import { classifyRun } from './lib/classify.mjs'
import { loadTargets, statePaths, resolveRepo, trackerPath, isSessionId } from './lib/targets.mjs'
import { runClaude, parseResult, launchRoots } from './lib/claude-run.mjs'
import { resumeGate, nowGate } from './lib/resume-gate.mjs'
import { printStatus, doRearm } from './lib/resume-report.mjs'
import { scanSessions } from './lib/sessions.mjs'
import { singleInstance } from './lib/single.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const DRY = flag('--dry-run'), FORCE = flag('--force')

/**
 * `--now` — **판정을 건너뛰고 지금 띄운다.** 화면의 `지금 재시작 실행` 이 이것으로 부른다.
 *
 * 🔴 사용자 결정 (2026-09-28): 그 단추는 사람의 의지로 누르는 것이니 **재시작 조건과
 *   상관없이** 재개지시를 실행한다. `--force` 와 다르다 — force 는 «기다리면 풀리는 것»만
 *   건너뛰고 일하는 세션·제한 중은 지켰다. `--now` 는 그 둘까지 건너뛴다.
 *
 * 🔴 대가를 분명히 적어 둔다: **다른 사람이 쓰고 있는 세션에도 끼어들 수 있다.**
 *   그래서 이 플래그는 사람이 단추를 누른 경로에서만 쓰고, 예약 회차는 절대 쓰지 않는다.
 *   확인 창이 그 사실을 누르기 전에 말한다(src/ui/detail.js).
 *
 * 🔴 그래도 남기는 두 가지 — 이것들은 «조건»이 아니라 **깨지면 복구가 안 되는 것**이다:
 *   ① 세션별 락·프로세스 단일 실행 — 같은 세션에 둘이 동시에 쓰면 서로를 덮어쓴다.
 *   ② 띄울 자리와 보낼 말 — 작업 디렉터리를 모르거나 보낼 지시가 없으면 띄울 수 없다.
 */
const NOW = flag('--now')

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
  /**
   * 🔴 `running`(pid) 은 더 이상 판정에 넘기지 않는다. "프로세스가 살아 있다"는
   *   "사람이 그 세션을 쓰고 있다"가 아니었고, 그 오해가 560회 연속 건너뜀을 만들었다.
   *   판정은 세션 집계(미완결 도구·마지막 차례·조용한 시간)로 한다 — resume-gate 참고.
   */
  const common = { P, project, state, limitStopped: !!s?.stoppedByLimit, interrupted: !!s?.stoppedByInterrupt }

  const tracker = tp ? { exists: true, ...readTracker(tp) } : { exists: false }

  /**
   * 🔴 `--now` 는 **재시작 조건을 하나도 보지 않는다.** 사람이 단추를 눌렀기 때문이다.
   *   그 판정도 여기서 짜지 않고 `nowGate` 한 곳에 둔다 — 조건을 보지 않는다는 것이
   *   «판정이 없다»는 뜻은 아니다(띄울 자리·보낼 말은 여전히 본다). 계약은
   *   `test/resume-now.test.mjs` 가 못박는다.
   */

  if (NOW) return { ...nowGate({ target, project, session: s, tracker }), ...common }

  const g = resumeGate({
    target, project, state, session: s, quota: ctx.quota, force: FORCE, tracker,
  })
  return { ...g, ...common }
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
 * 🔴 판정의 재료는 **트랜스크립트**다 — `claude agents --json` 의 pid 가 아니다.
 *
 *   예전에는 여기서 실행 목록을 먼저 읽고, 조회가 실패하면 회차를 통째로 건너뛰었다
 *   (모르면 멈춘다). 그 관문이 있던 이유는 "사람이 쓰는 대화에 끼어들지 않는다"였는데,
 *   pid 는 그 질문에 답하지 못한다 — 창을 열어 둔 채 다른 세션에서 일하면 pid 는 계속
 *   살아 있다. 실측으로 **560회 연속** 그 이유로 건너뛰었다(2026-09-22~09-28).
 *
 *   지금은 세션 집계가 답한다: 미완결 도구 · 마지막 차례 · 조용한 시간(resume-gate).
 *   그래서 CLI 조회가 흔들려도 판정이 멎지 않는다 — 흔들리는 그 조회가 판정에서 빠졌다.
 *   (실행 여부는 화면·경보에서 여전히 보여준다. 거기서는 "모른다"를 말해야 한다.)
 */
/**
 * 집계를 **다시 읽는다.** 증분 스캔이라 싸다(실측 0.4초 · 캐시가 따뜻하면 그 이하).
 * @param maxAgeMs 이보다 묵었을 때만 읽는다. 0 이면 무조건 읽는다.
 */
function refreshCtx(ctx, maxAgeMs = 0) {
  if (maxAgeMs > 0 && Date.now() - ctx.readAt <= maxAgeMs) return false
  const scan = scanSessions()
  ctx.sessionMap = new Map(scan.sessions.map((s) => [s.sessionId, s]))
  ctx.quota = scan.quota
  ctx.readAt = Date.now()
  return true
}

const ctx = { sessionMap: new Map(), quota: null, readAt: 0 }
refreshCtx(ctx)

let exitCode = 0

for (const target of items) {
  /**
   * 🔴 판정 직전에 다시 읽는다.
   *
   *   결함이었다: 집계를 루프 **밖에서 한 번만** 만들었다. 한 회차는 최대 30분이라
   *   (타임아웃분 기본값), 앞 세션을 미는 동안 사람이 다음 세션에 무언가 입력했을 수 있다.
   *   그러면 30분 묵은 집계를 보고 "조용하다"고 판정해 --resume 을 밀어넣는다.
   *
   *   창을 **10초**로 좁혔다(예전 60초). 판정의 재료는 "지금 사람이 쓰고 있나"이므로
   *   1분 묵은 값으로 답하면 안 된다 — 그 1분이 사람이 막 입력한 순간일 수 있다.
   */
  refreshCtx(ctx, 10_000)

  const v = verdict(target, ctx)
  const short = target.sessionId.slice(0, 8)

  if (!v.go) {
    logSkip(v.P, v.why)
    console.log(`⛔ ${short} 건너뜀 — ${v.why}`)
    continue
  }

  const prompt = buildPrompt(target, v.project, { limitStopped: v.limitStopped, interrupted: v.interrupted })

  if (DRY) {
    /**
     * 🔴 뿌리도 함께 보여준다 — **돈을 쓰지 않고** 확인할 수 있는 유일한 자리다.
     *   실측(2026-09-28): 잘못된 뿌리로 띄워 $18.27 을 쓰고 디스크 변경 0건으로 끝난 뒤,
     *   그것을 미리 볼 방법이 없었다는 것이 드러났다. 지시문은 "이 파일을 고쳐라"라고
     *   말하는데 그 파일이 cwd 밖이면 이 두 줄만 봐도 알 수 있다.
     */
    const roots = launchRoots(target, v.project)
    console.log(`✅ ${short} 재개 가능 — ${v.why}`)
    console.log(`  cwd ${roots.cwd}`)
    console.log(`  --add-dir ${roots.addDirs.join(' · ') || '(없음)'}`)
    console.log('─── 넘길 지시문 ───')
    console.log(prompt)
    console.log('───────────────────')
    continue
  }

  const cfg = v.project.resume
  const lock = acquireLock(v.P.resumeLock, cfg.lockStaleMin ?? 90)
  if (!lock.ok) {
    log(v.P, `${localStamp()} · SKIP · ${lock.why}`)
    console.log(`⛔ ${short} 건너뜀 — ${lock.why}`)
    continue
  }

  try {
    /**
     * 🔴 **띄우기 직전에 한 번 더 판정한다** — 최신 정보로.
     *
     *   판정과 실행 사이에도 시간이 흐른다: 집계를 읽고 → 지시문을 만들고 → 락을 잡고 →
     *   띄운다. 그 사이(보통 1초 안쪽, 락을 기다리면 더 길다)에 사람이 그 세션에 한 줄
     *   입력했을 수 있다. 그러면 "조용하다"는 이미 거짓인데 우리는 밀어 넣는다.
     *
     *   락을 잡은 **뒤에** 다시 본다 — 락 밖에서 보면 그 사이 다른 재개가 들어올 수 있다.
     *   판정은 같은 함수를 다시 부른다(규칙을 두 벌 만들지 않는다). 뒤집혔으면 띄우지
     *   않고 이유를 남긴다 — 사람이 쓰는 대화에 끼어들지 않는 것이 예산보다 먼저다.
     *   (--now 면 판정을 부르지 않으므로 여기서도 «띄울 자리·보낼 말» 만 다시 본다.)
     */
    refreshCtx(ctx)
    const again = verdict(target, ctx)
    if (!again.go) {
      logSkip(v.P, `${again.why} (락을 잡은 뒤 다시 판정했다 — 그 사이 상황이 바뀌었다)`)
      console.log(`⛔ ${short} 건너뜀 — ${again.why} (실행 직전 재판정)`)
      continue
    }

    /**
     * 🔴 뿌리는 **추적기를 소유한 저장소**다(launchRoots). 예전에는 등록부의 `runCwd` 를
     *   먼저 썼는데, 그러면 지시문이 가리키는 파일이 작업 폴더 밖에 있어 쓰기가 전부
     *   승인 대기로 떨어졌다 — 실측: `ok · 턴 22 · 권한거부 11건`, 디스크 변경 0건.
     *   쓸 수 있어야 하는 곳(세션이 일해 온 폴더)은 --add-dir 로 함께 넘어간다.
     */
    // 지시문도 **최신 판정으로** 다시 만든다 — 지점이 바뀌었으면 옛 지시문은 거짓이다
    const prompt2 = buildPrompt(target, again.project, { limitStopped: again.limitStopped, interrupted: again.interrupted })
    const { cwd, addDirs } = launchRoots(target, again.project)
    log(v.P, [
      '', '═'.repeat(70),
      `${localStamp()} · RUN 시작 · ${again.why}`,
      `  --resume ${target.sessionId} · 권한 ${cfg.permissionMode} · 타임아웃 ${cfg.timeoutMin}분`,
      `  cwd ${cwd}`,
      // 무엇을 쓸 수 있었는지 남긴다 — 권한거부가 나면 여기부터 본다
      addDirs.length ? `  --add-dir ${addDirs.join(' · ')}` : '  --add-dir (없음)',
    ].join('\n'))
    console.log(`▶ ${short} 재개 — ${again.why}`)

    /** 띄우기 직전의 누적 비용 — 잘린 회차의 몫을 재려면 시작점이 있어야 한다(아래) */
    const costBefore = ctx.sessionMap.get(target.sessionId)?.costUSD || 0

    const r = await runClaude({
      sessionId: target.sessionId, cwd, prompt: prompt2, cfg, addDirs,
    })
    const p = parseResult(r.stdout)

    /**
     * 🔴 **잘려 나간 회차도 비용을 남긴다** (실측 결함 2026-09-28).
     *
     *   `--output-format json` 은 **끝에 한 번** 출력한다. 그래서 타임아웃으로 kill 하면
     *   비용·턴·요약이 통째로 사라지고 `$0 · 턴 ?` 로 기록됐다 — 실제로는 그 세 회차가
     *   그날 가장 많이 태운 회차였다(같은 방법으로 재면 성공 회차의 1.5~3배).
     *   장부에 없는 지출은 «안 썼다» 로 읽히고, 그 숫자를 보고 상한을 정하면 틀린다.
     *
     *   증인은 트랜스크립트다. 회차 전후의 누적 비용 차이를 쓴다 — 증분 스캔이라 싸다.
     *   🔴 이 값은 «그 세션이 그 사이에 쓴 것» 이다. 판정이 조용한 세션만 띄우므로 보통
     *   우리 회차의 몫이지만, 사람이 같은 세션에 끼어들었다면 그 몫도 섞인다.
     *   그래서 어디서 얻은 값인지 로그에 **적는다** — 섞인 값을 모르고 쓰는 것이 더 나쁘다.
     */
    let costUSD = p.costUSD, costFrom = null
    if (!(costUSD > 0)) {
      refreshCtx(ctx)
      const delta = +(((ctx.sessionMap.get(target.sessionId)?.costUSD || 0) - costBefore).toFixed(4))
      if (delta > 0) { costUSD = delta; costFrom = '트랜스크립트 실측' }
    }
    /**
     * 🔴 **우리 잘못이 아닌 실패**를 실패로 세면 세 번 만에 회로가 차단되고, 저쪽이
     *   멀쩡해진 뒤에도 사람이 --rearm 을 해줄 때까지 재개가 멎는다. 제한(때가 아닌 것) ·
     *   과부하(저쪽이 흔들린 것) · 인증(전제가 사라진 것) 셋 다 그렇다.
     *   판정 순서가 곧 결론이라 classify.classifyRun 하나로 두고 시험으로 고정한다.
     */
    const didFail = r.timedOut || r.code !== 0 || !p.ok
    const result = classifyRun({ timedOut: r.timedOut, failed: didFail, label: `${p.summary} ${r.stderr}` })

    const prev = loadRunState(v.P.resumeState)
    const next = recordRun(prev, {
      result, summary: p.summary, tookSec: r.tookSec, costUSD, costFrom,
      turns: p.turns, sid: p.sid, permDenied: p.permDenied, exit: r.code,
      // 같은 자리를 두 번 이어 밀지 않으려면 **무엇을 이어서** 띄웠는지 남아야 한다
      point: again.point,
    }, cfg)
    saveRunState(v.P.resumeState, next)

    log(v.P, [
      `${localStamp()} · RUN 끝 · ${result} · ${r.tookSec}초 · $${costUSD}${costFrom ? ` (${costFrom})` : ''}`
        + ` · 턴 ${p.turns ?? '?'} · exit ${r.code}` +
        (p.permDenied ? ` · 권한거부 ${p.permDenied}건` : '') +
        (r.timedOut ? ` · 🔴 타임아웃(${cfg.timeoutMin}분)으로 강제 종료 — 일하는 중이었을 수 있다` : ''),
      // 세션이 갈라졌는지 확인한다 — 같아야 정상이다
      p.sid && p.sid !== target.sessionId ? `  ⚠ 세션이 갈라졌다: ${p.sid}` : '',
      '  ── 요약 ──',
      (p.summary || '(없음)').split('\n').map((l) => '  ' + l).join('\n'),
      r.stderr.trim() ? '  ── stderr ──\n' + r.stderr.trim().split('\n').slice(-20).map((l) => '  ' + l).join('\n') : '',
      /**
       * 🔴 차단의 **실제 이유**를 적는다 — `next.failStreak` 이 아니다.
       *   성공은 연속실패를 0 으로 되돌리므로, 옛 코드는 성공 뒤에 남은 차단을
       *   `연속 0회 실패로 회로 차단됨` 이라고 적었다(실측 2026-09-29). 읽는 사람이
       *   숫자를 믿으면 «0회인데 왜 차단인가» 에서 멈춘다. 이유는 차단이 들고 있다.
       */
      next.blocked ? `  🔴 회로 차단됨 (${next.blocked.at}): ${next.blocked.reason} — 고친 뒤 --rearm` : '',
      // 성공이 차단을 풀었으면 그 사실을 남긴다 — 조용히 풀면 아무도 모른다
      prev.blocked && !next.blocked ? `  ✅ 성공했으므로 회로 차단을 풀었다 (이전: ${prev.blocked.reason})` : '',
    ].filter(Boolean).join('\n'))

    // 🔴 제한·과부하·인증·타임아웃은 우리 실패가 아니다 — 스케줄러 이력을 빨갛게 물들이지
    //   않는다. 가드에 막힌 회차가 exit 0 인 것과 같은 이유다. 때가 아닌 것이지 고장이 아니다.
    //   대신 경보로 나간다 — exit 0 이 "괜찮다"는 뜻이 되지 않게(alerts.mjs).
    const notOurFault = result === 'limited' || result === 'overload' || result === 'auth' || result === 'timeout'
    const shown = result === 'ok' ? '✅' : notOurFault ? '◔' : '✖'
    console.log(`${shown} ${short} — ${result} · ${r.tookSec}초 · $${costUSD}`)
    if (result !== 'ok' && !notOurFault) exitCode = 1
  } finally {
    releaseLock(v.P.resumeLock)
  }
}

process.exit(exitCode)
