/**
 * heartbeat.mjs — 감시를 켠 세션마다 "지금 어디까지 왔는가"를 디스크에 남긴다.
 *
 * 왜 필요한가 (추적기·트랜스크립트만으로는 부족하다)
 *   추적기는 **단계 경계**에서만 갱신된다. 한 단계가 길면(원본 계획의 W3-2 는 수정 64건,
 *   W1 은 문서 42건) 중간에 끊겼을 때 "doing" 이라고만 말하고 그 안에서 어디까지 했는지는
 *   말해주지 않는다. 트랜스크립트는 그 답을 갖고 있지만 21MB 다 — 재개할 때 읽을 것이 아니다.
 *   이 파일이 5분마다 **요약 한 장**을 남겨 그 구간을 메운다.
 *
 * 🔴 왜 --loop 이 없는가 (실측 사고)
 *   2026-09-16 23:02 ~ 09-17 08:04 (9시간) setInterval 이 멈춰 기록이 끊겼다.
 *   절전 아님(Kernel-Power 0건) · 재부팅 아님(가동 46.6h) · 프로세스 사망 아님(PID 28472 생존).
 *   PC 는 깨어 있었고 프로세스도 살아 있었는데 **타이머만 멈췄다.**
 *   장수 타이머를 버렸다 — 5분마다 OS 가 새 프로세스로 띄우면 얼어붙을 타이머가 없다.
 *   **이 파일에 --loop 을 다시 넣지 마라. 그게 사고의 원인이었다.**
 *
 * 사용법
 *   node src/heartbeat.mjs           감시 켜진 세션 전부 1회 기록
 *   node src/heartbeat.mjs --check   살아있는지 판정만 (기록 안 함. 낡으면 exit 1)
 *   node src/heartbeat.mjs --list    감시 대상 목록
 */
import { readFileSync } from 'node:fs'
import { localStamp } from './lib/stamp.mjs'
import { heartbeatVerdict } from './lib/guard.mjs'
import { loadTargets, statePaths, isSessionId } from './lib/targets.mjs'
import { writeJsonAtomic, appendLine } from './lib/io.mjs'
import { fullStatus } from './lib/status.mjs'
import { sessionDetail } from './lib/detail.mjs'
import { taskNames } from './lib/scheduler.mjs'
import { singleInstance } from './lib/single.mjs'
import { changeLog } from './lib/alerts.mjs'
import { loadConfig } from './lib/config.mjs'
import { autoWatchNew } from './lib/autowatch.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)

/* ── --list ─────────────────────────────────────────────────── */
if (flag('--list')) {
  const t = loadTargets()
  const rows = Object.entries(t.targets)
  if (!rows.length) console.log('감시·재시작 대상이 없다. UI 에서 세션을 골라 켜라 (npm run ui).')
  for (const [id, v] of rows) {
    console.log(`${id.slice(0, 8)} · 감시 ${v.watch ? 'O' : 'X'} · 재시작 ${v.restart ? 'O' : 'X'} · ${v.title || v.runCwd || ''}`)
  }
  process.exit(0)
}

/* ── --check : fail-closed 판정. 모르면 죽음으로 본다 ────────── */
if (flag('--check')) {
  const t = loadTargets()
  const watch = Object.entries(t.targets).filter(([, v]) => v.watch)
  if (!watch.length) {
    console.log('ℹ 감시 대상이 없다 — 판정할 것이 없다 (이것은 정상이다)')
    process.exit(0)
  }
  let dead = 0
  for (const [id, v] of watch) {
    // 형태가 아닌 id 는 판정할 수 없다 = 살아있다고 말할 수 없다 (fail-closed)
    if (!isSessionId(id)) {
      dead++
      console.error(`✖ '${String(id).slice(0, 40)}' — 세션 id 형태가 아니다. 등록부를 확인하라`)
      continue
    }
    const P = statePaths(id)
    let hb = null
    try { hb = JSON.parse(readFileSync(P.heartbeat, 'utf8')) } catch { hb = null }
    const limit = v.staleLimitMin ?? 15
    const onEpoch = typeof v.watchOnEpoch === 'number'
      ? v.watchOnEpoch
      : (Date.parse(v.updatedAt || v.addedAt || '') || null)
    const r = heartbeatVerdict(hb, limit, Date.now(), onEpoch)
    const name = `${id.slice(0, 8)} ${v.title ? `(${v.title.slice(0, 30)})` : ''}`
    if (r.alive) console.log(`✅ ${name} — ${r.ageMin}분 전 기록 (한계 ${limit}분)`)
    /**
     * 🔴 대기는 죽음이 아니다 — 아직 쓸 기회가 없었을 뿐이다.
     *   fail-closed 를 어기는 것이 아니다: 대기 창은 한계 시간까지만이고
     *   그 뒤에는 위의 판정이 죽음으로 답한다. 모르는 것을 정상이라 하는 게 아니라,
     *   **아직 때가 아닌 것**을 고장이라 하지 않는 것이다.
     */
    else if (r.waiting) console.log(`◔ ${name} — ${r.why}`)
    else { dead++; console.error(`✖ ${name} 하트비트 죽음 — ${r.why}`) }
  }
  if (dead) {
    console.error('')
    console.error(`  되살리기: powershell -Command "Start-ScheduledTask -TaskName ${taskNames.heartbeat}"`)
    console.error('  작업이 아예 없으면 재등록: powershell -ExecutionPolicy Bypass -File scripts/register-heartbeat.ps1')
    process.exit(1)
  }
  process.exit(0)
}

/* ── 기본: 1회 기록 ─────────────────────────────────────────── */

/**
 * 🔴 한 번에 하나만 기록한다.
 *   둘이 같은 heartbeat.json 을 덮어쓰면 기록이 찢어진다. 예약의
 *   MultipleInstances IgnoreNew 는 스케줄러끼리만 막으므로, 사람이 손으로 돌리거나
 *   화면·트레이에서 "지금 실행"을 누른 경우가 겹칠 수 있다.
 *   한 회차는 보통 몇 초다 — 30분을 넘겼다면 죽은 락으로 본다.
 */
singleInstance('heartbeat', { staleMin: 30 })

/**
 * 설정된 저장소에서 **새로 뜬 세션에 감시를 붙인다** (autoWatch 를 켠 저장소만, 기본 꺼짐).
 *
 * 🔴 집계(fullStatus)가 필요하므로 **켜져 있을 때만** 당겨 온다. 아무도 안 켰으면
 *   한 푼도 쓰지 않는다 — 5분마다 도는 자리에 공짜가 아닌 것을 무조건 넣지 않는다.
 */
const autoWatchOn = (loadConfig().projects || []).some((p) => p?.heartbeat?.autoWatch === true)
let status0 = null
if (autoWatchOn) {
  status0 = fullStatus()
  const { added } = autoWatchNew(status0.sessions)
  if (added.length) {
    console.log(`자동 감시 등록 ${added.length}개 — ${added.map((x) => x.slice(0, 8)).join(', ')}`)
    status0 = null   // 등록부가 바뀌었다. 아래에서 다시 모은다.
  }
}

const registry = loadTargets()
const turnedOn = Object.entries(registry.targets).filter(([, v]) => v.watch).map(([id]) => id)

// 세션 id 형태가 아닌 항목은 경로가 될 수 없다. 알린 뒤 건너뛴다 —
// 한 줄이 이상하다고 나머지 감시까지 멈추면 그게 더 나쁘다.
const watchTarget = turnedOn.filter(isSessionId)
for (const bad of turnedOn.filter((id) => !isSessionId(id))) {
  console.warn(`⚠ 등록부의 '${String(bad).slice(0, 40)}' 는 세션 id 형태가 아니다 — 건너뛴다`)
}

if (!watchTarget.length) {
  console.log(`하트비트 ${localStamp()} — 감시 대상이 없다. 기록할 것이 없다.`)
  process.exit(0)
}

// 집계는 한 번만 한다 — CLI 호출과 스캔이 들어 있어 세션마다 다시 하면 낭비다
const S = status0 ?? fullStatus()
const sessionMap = new Map(S.sessions.map((s) => [s.sessionId, s]))

/**
 * 경보 이력은 여기서 남긴다 — 5분마다 도는 것이 이것뿐이기 때문이다.
 *
 * 화면을 닫아둔 사이에 생긴 일을 놓치면 안 되고, 그렇다고 Windows 풍선으로
 * 띄우지도 않는다(너무 자주 떠서 진짜 경고가 묻혔다). **변화가 있을 때만** 적는다.
 */
const alertDiff = changeLog(S.alerts || [])
if (alertDiff.record) {
  const n = (S.alerts || []).length
  console.log(n ? `⚠ 경보 ${n}건 (변화 기록됨)` : '✅ 경보 해소 (기록됨)')
  for (const a of S.alerts || []) console.log(`   ${a.level} · ${a.title} — ${a.desc}`)
}

for (const id of watchTarget) {
  const P = statePaths(id)
  const s = sessionMap.get(id)

  if (!s) {
    // 등록은 돼 있는데 세션이 사라졌다(정리됨·purge). 감추지 않고 그대로 남긴다.
    const none = {
      _note: '5분마다 덮어쓴다. 추적하지 않는다 — 단계 경계 기록은 대상 저장소의 추적기가 정본이다.',
      at: localStamp(), atEpoch: Date.now(), sessionId: id,
      error: '이 세션을 찾을 수 없다 — 트랜스크립트가 정리됐거나 claude project purge 된 것으로 보인다',
    }
    writeJsonAtomic(P.heartbeat, none)
    appendLine(P.hbLogPath, `${none.at} · (세션 없음) · ${none.error}`)
    console.warn(`⚠ ${id.slice(0, 8)} — 세션을 찾을 수 없다`)
    continue
  }

  // 트랜스크립트 꼬리에서 "무엇을 하던 중인가" — 21MB 여도 512KB 만 읽는다
  let progress = null, unfinished = []
  try {
    const d = sessionDetail(id, { turns: 3, maxBytes: 256 * 1024, textLen: 300 })
    if (d.ok) { progress = d.progress; unfinished = d.progress.openTools }
  } catch { /* 상세 실패로 기록을 끊지 않는다 */ }

  const snap = {
    _note: '5분마다 덮어쓴다. 추적하지 않는다(.gitignore) — 단계 경계 기록은 대상 저장소의 추적기가 정본이다.',
    // 🔴 시각은 로컬 시간. UTC 로 적으면 KST 기준 9시간 낡아 보여 오판을 부른다(실측).
    at: localStamp(),
    atEpoch: Date.now(), // 낡음 판정은 문자열이 아니라 이 값으로 한다
    sessionId: id,
    title: s.title,
    running: s.running, runKnown: s.runKnown !== false, pid: s.pid,
    activeMin: s.activeMin,
    runCwd: s.runCwd, mainCwd: s.mainCwd,
    repo: s.repoId,
    stage: s.tracker.exists
      ? { id: s.tracker.doing?.id || '(doing 없음)', title: s.tracker.doing?.title, evidence: s.tracker.doing?.evidence, doneStages: s.tracker.doneMark }
      : { id: '(추적기 없음)' },
    nextAction: s.tracker.nextAction || null,
    allDone: !!s.tracker.allDone,
    doingViolations: s.tracker.doingViolations || null,
    progress,
    git: s.git,
    usage: { tokenSum: s.tokenSum, costUSD: s.costUSD, message: `u${s.userMsgs}/a${s.assistantMsgs}`, toolCalls: s.toolCalls },
    quota: S.quota,
  }
  /**
   * 🔴 원자적으로 쓴다. 이 파일은 "살아 있나"의 정본이고, 판정은 fail-closed 라
   *   반쯤 쓰인 JSON 은 곧바로 "감시 끊김" 경보가 된다. 5분마다 쓰는 파일이니
   *   그 창을 없애 두지 않으면 언젠가 그 순간에 맞는다.
   */
  writeJsonAtomic(P.heartbeat, snap)

  const tools = unfinished.length ? `도구중 ${unfinished.map((t) => t.name).join(',')}` : (progress?.lastKind || '-')
  appendLine(P.hbLogPath, [
    snap.at,
    // 🔴 조회 실패를 '정지'로 적으면 나중에 이 기록을 읽는 사람이 속는다
    s.runKnown === false ? '실행여부모름' : (s.running ? '실행중' : '정지'),
    snap.stage.id,
    snap.stage.doneStages || '',
    `HEAD ${s.git?.head || '-'}`,
    `미커밋 ${s.git?.uncommittedFiles ?? '-'}`,
    tools,
  ].join(' · ') + '\n')

  console.log(
    `하트비트 [${id.slice(0, 8)}] ${snap.at} · ` +
    `${s.runKnown === false ? '실행여부모름' : (s.running ? '실행중' : '정지')}` +
    ` · 단계 ${snap.stage.id}${snap.stage.doneStages ? ` (${snap.stage.doneStages})` : ''}` +
    ` · 미커밋 ${s.git?.uncommittedFiles ?? '-'}`
  )
  if (snap.doingViolations) console.warn(`  ⚠ doing 이 ${snap.doingViolations.length}개다 (${snap.doingViolations.join(', ')}) — 규약은 한 번에 하나다`)
}
