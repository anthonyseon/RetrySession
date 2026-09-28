/**
 * guard.test.mjs — 판정 로직을 고정한다.
 *
 * 왜 이 시험이 있는가 (실측 사고)
 *   2026-09-17: 손으로 쓴 하트비트 판정이 `atEpoch` 가 없을 때 "살아있음"으로 답했다.
 *   실제로는 9시간 낡은 상태였고, 그 fail-open 때문에 중단을 놓쳤다.
 *   **감시 장치가 "모르면 정상"이라고 답하면 감시가 아니다.**
 *   그래서 "모르면 죽음/금지"를 여기서 시험으로 못박는다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  heartbeatVerdict, quietNow, budgetVerdict, recordRun, rearm,
  loadRunState, acquireLock, releaseLock, emptyState, sessionRunning,
} from '../src/lib/guard.mjs'

const minutes = 60_000
const base = new Date('2026-09-18T12:00:00').getTime()

/* ── 하트비트 낡음 판정: fail-closed ──────────────────────────── */

test('하트비트 — 최근 기록은 살아있음', () => {
  const v = heartbeatVerdict({ atEpoch: base - 3 * minutes }, 15, base)
  assert.equal(v.alive, true)
  assert.equal(v.ageMin, 3)
})

test('하트비트 — 한계를 넘기면 죽음', () => {
  const v = heartbeatVerdict({ atEpoch: base - 20 * minutes }, 15, base)
  assert.equal(v.alive, false)
  assert.match(v.why, /20분 전/)
})

test('하트비트 — 한계 경계값은 살아있음 (초과일 때만 죽음)', () => {
  assert.equal(heartbeatVerdict({ atEpoch: base - 15 * minutes }, 15, base).alive, true)
  assert.equal(heartbeatVerdict({ atEpoch: base - 16 * minutes }, 15, base).alive, false)
})

test('🔴 하트비트 — atEpoch 가 없으면 죽음으로 본다 (실측 사고 재발 방지)', () => {
  const v = heartbeatVerdict({ at: '2026-09-18 11:59:00' }, 15, base)
  assert.equal(v.alive, false, 'atEpoch 없는 파일을 살아있다고 답하면 안 된다')
  assert.match(v.why, /atEpoch/)
})

test('🔴 하트비트 — 파일을 못 읽으면(null) 죽음으로 본다', () => {
  assert.equal(heartbeatVerdict(null, 15, base).alive, false)
})

test('하트비트 — 미래 시각은 시계 어긋남으로 죽음', () => {
  const v = heartbeatVerdict({ atEpoch: base + 30 * minutes }, 15, base)
  assert.equal(v.alive, false)
  assert.match(v.why, /미래/)
})

/* ── 조용한 시간 ─────────────────────────────────────────────── */

test('조용한시간 — null 이면 끈 것', () => {
  assert.equal(quietNow(null, new Date(base)).quiet, false)
})

test('조용한시간 — 자정을 넘기는 구간', () => {
  const q = { from: '23:30', to: '07:00' }
  assert.equal(quietNow(q, new Date('2026-09-18T23:45:00')).quiet, true)
  assert.equal(quietNow(q, new Date('2026-09-18T03:00:00')).quiet, true)
  assert.equal(quietNow(q, new Date('2026-09-18T12:00:00')).quiet, false)
  assert.equal(quietNow(q, new Date('2026-09-18T07:00:00')).quiet, false, 'to 는 미포함')
})

test('조용한시간 — 같은 날 안의 구간', () => {
  const q = { from: '09:00', to: '18:00' }
  assert.equal(quietNow(q, new Date('2026-09-18T10:00:00')).quiet, true)
  assert.equal(quietNow(q, new Date('2026-09-18T20:00:00')).quiet, false)
})

test('🔴 조용한시간 — 형식이 틀리면 조용한 시간으로 본다(fail-closed)', () => {
  const v = quietNow({ from: '이상함', to: '07:00' }, new Date(base))
  assert.equal(v.quiet, true)
  assert.match(v.why, /형식/)
})

/* ── 예산·회로차단기 ─────────────────────────────────────────── */

const cfg = { minGapMin: 30, maxPerDay: 3, maxCostUSDPerDay: 5, failStreakMax: 3 }

test('예산 — 빈 상태는 통과', () => {
  assert.equal(budgetVerdict(emptyState(), cfg, base).ok, true)
})

test('예산 — 최소 간격 안이면 막는다', () => {
  const s = { ...emptyState(), lastRun: { atEpoch: base - 10 * minutes } }
  const v = budgetVerdict(s, cfg, base)
  assert.equal(v.ok, false)
  assert.match(v.why, /최소 간격/)
})

test('예산 — 간격을 넘겼으면 통과', () => {
  const s = { ...emptyState(), lastRun: { atEpoch: base - 31 * minutes } }
  assert.equal(budgetVerdict(s, cfg, base).ok, true)
})

test('예산 — 하루 횟수 상한', () => {
  const s = { ...emptyState(), byDay: { '2026-09-18': 3 } }
  const v = budgetVerdict(s, cfg, base)
  assert.equal(v.ok, false)
  assert.match(v.why, /하루 상한 3회/)
})

/**
 * 🔴 **비용은 막지 않는다 — 통계로만 본다** (사용자 결정 2026-09-28). 걷어낸 이유: 상한은
 *   띄우기 전에만 보므로 한 회차가 넘는 것을 못 막고(실측: 상한 $5, 한 회차 $18.271),
 *   넘은 뒤에는 그날 나머지를 전부 막아 "일해야 할 때만" 멈췄다. 지금은 횟수·타임아웃이 묶는다.
 */
test('🔴 비용이 참고선을 넘어도 막지 않는다 (통계로만 쓴다)', () => {
  const s = { ...emptyState(), byDay: { '2026-09-18': 1 }, costByDay: { '2026-09-18': 999 } }
  const v = budgetVerdict(s, cfg, base)
  assert.equal(v.ok, true, '비용으로 막으면 안 된다')
  assert.equal(v.costToday, 999, '그래도 얼마 썼는지는 돌려줘야 한다 — 통계는 남는다')
})

test('비용이 넘었어도 막는 것은 횟수다 (둘을 섞지 않는다)', () => {
  const v = budgetVerdict({ ...emptyState(), byDay: { '2026-09-18': 3 }, costByDay: { '2026-09-18': 999 } }, cfg, base)
  assert.equal(v.ok, false)
  assert.match(v.why, /하루 상한 3회/, '이유는 횟수여야 한다 — 비용을 이유로 대면 거짓이다')
})

test('예산 — 어제 기록은 오늘 예산에 영향 없다', () => {
  const s = { ...emptyState(), byDay: { '2026-09-17': 99 }, costByDay: { '2026-09-17': 99 } }
  assert.equal(budgetVerdict(s, cfg, base).ok, true)
})

test('예산 — 연속실패 한계에서 막는다', () => {
  const v = budgetVerdict({ ...emptyState(), failStreak: 3 }, cfg, base)
  assert.equal(v.ok, false)
  assert.match(v.why, /연속 3회/)
})

test('예산 — 회로 차단되면 막는다', () => {
  const v = budgetVerdict({ ...emptyState(), blocked: { at: 'x', reason: '연속 3회 실패' } }, cfg, base)
  assert.equal(v.ok, false)
  assert.match(v.why, /회로 차단/)
})

test('🔴 예산 — 상태 파일이 깨졌으면 막는다(fail-closed)', () => {
  const v = budgetVerdict({ ...emptyState(), corrupt: '파일이 깨졌다' }, cfg, base)
  assert.equal(v.ok, false, '몇 번 돌았는지 모르면 돌리지 않는다')
})

/* ── 실행 기록 ───────────────────────────────────────────────── */

test('기록 — 성공은 연속실패를 0으로 되돌린다', () => {
  const s = { ...emptyState(), failStreak: 2 }
  const n = recordRun(s, { result: 'ok', summary: '됐다', tookSec: 10, costUSD: 0.5 }, cfg, base)
  assert.equal(n.failStreak, 0)
  assert.equal(n.blocked, null)
  assert.equal(n.byDay['2026-09-18'], 1)
  assert.equal(n.costByDay['2026-09-18'], 0.5)
})

test('기록 — 비용은 같은 날에 누적된다', () => {
  let s = emptyState()
  s = recordRun(s, { result: 'ok', tookSec: 1, costUSD: 0.25 }, cfg, base)
  s = recordRun(s, { result: 'ok', tookSec: 1, costUSD: 0.3 }, cfg, base)
  assert.equal(s.byDay['2026-09-18'], 2)
  assert.equal(s.costByDay['2026-09-18'], 0.55)
})

test('기록 — 연속실패가 한계에 닿으면 회로를 차단한다', () => {
  let s = emptyState()
  for (let i = 0; i < 3; i++) s = recordRun(s, { result: 'fail', tookSec: 1 }, cfg, base)
  assert.equal(s.failStreak, 3)
  assert.ok(s.blocked, '한계에 닿으면 차단되어야 한다')
  assert.equal(budgetVerdict(s, cfg, base).ok, false)
})

test('기록 — timeout 도 실패로 센다', () => {
  const n = recordRun(emptyState(), { result: 'timeout', tookSec: 1800 }, cfg, base)
  assert.equal(n.failStreak, 1)
})

test('--rearm 은 차단과 연속실패를 푼다', () => {
  const s = { ...emptyState(), failStreak: 5, blocked: { at: 'x', reason: 'y' }, byDay: { '2026-09-18': 2 } }
  const n = rearm(s)
  assert.equal(n.failStreak, 0)
  assert.equal(n.blocked, null)
  assert.equal(n.byDay['2026-09-18'], 2, '하루 횟수는 남긴다 — 예산은 풀지 않는다')
  assert.equal(budgetVerdict(n, cfg, base).ok, true)
})

/* ── 상태 파일 읽기 ─────────────────────────────────────────── */

test('상태 — 파일이 없으면 빈 상태(첫 실행이므로 허용)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const s = loadRunState(join(dir, '없는파일.json'))
    assert.equal(s.corrupt, undefined)
    assert.equal(budgetVerdict(s, cfg, base).ok, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('🔴 상태 — 파일이 깨졌으면 손상 표시 (없는 것과 구별한다)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const p = join(dir, 'resume.json')
    writeFileSync(p, '{깨진 JSON')
    assert.ok(loadRunState(p).corrupt)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

/* ── 락 ──────────────────────────────────────────────────────── */

test('락 — 잡고 풀면 다시 잡힌다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const p = join(dir, 'resume.lock')
    assert.equal(acquireLock(p, 60).ok, true)
    releaseLock(p)
    assert.equal(acquireLock(p, 60).ok, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('락 — 살아있는 프로세스가 잡고 있으면 막는다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const p = join(dir, 'resume.lock')
    // 자기 PID 로 락을 심는다 — 이 프로세스는 분명히 살아있다
    writeFileSync(p, JSON.stringify({ pid: process.pid, atEpoch: Date.now() }))
    const v = acquireLock(p, 60)
    assert.equal(v.ok, false)
    assert.match(v.why, /이미 돌고 있다/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('락 — 죽은 프로세스의 락은 회수한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const p = join(dir, 'resume.lock')
    // PID 1 은 Windows 에서 이 프로세스가 신호를 보낼 수 없다 → 죽은 것으로 취급된다
    writeFileSync(p, JSON.stringify({ pid: 999_999_999, atEpoch: Date.now() }))
    assert.equal(acquireLock(p, 60).ok, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('락 — 한계를 넘긴 낡은 락은 살아있어도 회수한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const p = join(dir, 'resume.lock')
    writeFileSync(p, JSON.stringify({ pid: process.pid, atEpoch: Date.now() - 120 * minutes }))
    assert.equal(acquireLock(p, 60).ok, true, '60분 한계를 넘긴 락은 회수한다')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('락 — 깨진 락 파일은 낡은 것으로 보고 회수한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const p = join(dir, 'resume.lock')
    writeFileSync(p, '깨짐')
    assert.equal(acquireLock(p, 60).ok, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

/* ── 세션이 돌고 있는가 (fail-closed) ───────────────────────── */

/**
 * 🔴 이 묶음이 지키는 것: "모르면 밀지 않는다".
 *   고치기 전에는 목록 조회가 실패해도 빈 배열이 내려와 전부 "안 돌고 있다"가 됐다.
 */
const alive = () => true
const dead = () => false

test('🔴 실행중 — 목록 조회가 실패하면 "돌고 있다"로 답한다 (실측 결함)', () => {
  const v = sessionRunning({ ok: false, error: 'claude 를 찾을 수 없다', sessions: [] }, 'a', alive)
  assert.equal(v.running, true, '모르는데 "안 돈다"고 하면 사람이 쓰는 대화에 끼어든다')
  assert.equal(v.isCertain, false)
  assert.match(v.why, /확인할 수 없다/)
})

test('🔴 실행중 — 목록 자체가 없으면(undefined·null) 막는다', () => {
  for (const none of [undefined, null]) {
    assert.equal(sessionRunning(none, 'a', alive).running, true, `${String(none)} 일 때 통과시키면 안 된다`)
  }
})

test('🔴 실행중 — ok 가 true 가 아닌 값이면 막는다 (truthy 로 느슨하게 보지 않는다)', () => {
  for (const ambiguous of [1, 'ok', {}]) {
    assert.equal(sessionRunning({ ok: ambiguous, sessions: [] }, 'a', alive).running, true)
  }
})

test('실행중 — 목록에 있고 pid 가 살아 있으면 막는다', () => {
  const v = sessionRunning({ ok: true, sessions: [{ sessionId: 'a', pid: 123 }] }, 'a', alive)
  assert.equal(v.running, true)
  assert.equal(v.isCertain, true)
  assert.match(v.why, /pid 123/)
})

test('실행중 — 목록에 있어도 pid 가 죽었으면 통과한다 (목록이 낡을 수 있다)', () => {
  const v = sessionRunning({ ok: true, sessions: [{ sessionId: 'a', pid: 123 }] }, 'a', dead)
  assert.equal(v.running, false)
  assert.equal(v.isCertain, true)
})

test('실행중 — 조회에 성공했고 목록에 없으면 통과한다 (이때만 "빈 목록"을 믿는다)', () => {
  const v = sessionRunning({ ok: true, sessions: [] }, 'a', alive)
  assert.equal(v.running, false)
  assert.equal(v.isCertain, true)
  assert.equal(v.why, null)
})

test('실행중 — 다른 세션이 돌고 있는 것은 이 세션과 무관하다', () => {
  const v = sessionRunning({ ok: true, sessions: [{ sessionId: 'b', pid: 1 }] }, 'a', alive)
  assert.equal(v.running, false)
})

/* ── 락을 만드는 동작 자체가 잠금인가 ───────────────────────── */

test('🔴 락 — 이미 있는 파일을 덮어쓰지 않는다 (보고-쓰기 사이의 틈을 없앤다)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const p = join(dir, 'resume.lock')
    // 살아 있는 남의 락을 심는다
    writeFileSync(p, JSON.stringify({ pid: process.pid, atEpoch: Date.now() }))
    const prevText = readFileSync(p, 'utf8')
    assert.equal(acquireLock(p, 60).ok, false)
    assert.equal(readFileSync(p, 'utf8'), prevText, '막힌 쪽이 남의 락을 건드리면 안 된다')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('🔴 락 — 두 번 연달아 잡으면 두 번째는 막힌다 (같은 프로세스여도)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-'))
  try {
    const p = join(dir, 'resume.lock')
    assert.equal(acquireLock(p, 60).ok, true)
    assert.equal(acquireLock(p, 60).ok, false, '두 번째도 통과하면 락이 아무 일도 안 하는 것이다')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

/* ── 첫 기록 대기 vs 끊김 ───────────────────────────────────── */

/**
 * 🔴 실측 사건 (2026-09-21)
 *   사용자가 ChatTest 세션의 감시를 16:11:49 에 켰다. 하트비트 작업은 16:11:01 에
 *   돌았고 다음은 16:16:00 — **켜기 38초 전에 지나갔으니 쓸 기회가 없었다.**
 *   그런데 화면은 5분 동안 치명 경보 «감시가 끊겼습니다 / 하트비트 파일을 읽을
 *   수 없다» 를 띄웠다. 아무것도 고장나지 않았는데.
 *
 *   멀쩡한 것을 고장이라 부르는 것은 이 저장소가 반복해서 고쳐 온 실패다.
 *   늑대를 외치면 진짜 늑대를 놓친다.
 */
test('🔴 감시를 켠 직후 기록이 없는 것은 대기다 (끊김이 아니다)', () => {
  const v = heartbeatVerdict(null, 15, base, base - 1 * minutes)
  assert.equal(v.waiting, true, '켠 지 1분은 아직 기다릴 때다')
  assert.equal(v.alive, false, '그렇다고 살아있다고 하면 안 된다 — 기록은 없다')
  assert.match(v.why, /기다리는 중/, '왜 기다리는지 말해야 한다')
})

test('대기는 한계 시간까지만이다 (경계)', () => {
  assert.equal(heartbeatVerdict(null, 15, base, base - 15 * minutes).waiting, true, '15분은 아직 한계 안')
  assert.equal(heartbeatVerdict(null, 15, base, base - 16 * minutes).waiting, false, '16분이면 대기가 끝난다')
})

test('🔴 한계를 넘겼는데 첫 기록이 없으면 죽음이다 (창을 무한정 열어두지 않는다)', () => {
  const v = heartbeatVerdict(null, 15, base, base - 60 * minutes)
  assert.equal(v.waiting, false)
  assert.equal(v.alive, false)
  assert.match(v.why, /첫 기록이 없다/, '무엇이 잘못됐는지 말해야 한다')
  assert.match(v.why, /돌지 않는다/, '조치할 방향을 짚어야 한다')
})

test('🔴 켠 시각을 모르면 대기로 봐주지 않는다 (fail-closed)', () => {
  // 옛 등록부에는 epoch 이 없다. 모를 때 봐주면 진짜 끊김을 놓친다.
  for (const none of [null, undefined, NaN, Infinity, '2026-09-21']) {
    const v = heartbeatVerdict(null, 15, base, none)
    assert.equal(v.waiting, false, `켠 시각이 ${String(none)} 일 때 대기로 봐주면 안 된다`)
    assert.equal(v.alive, false)
  }
})

test('기록이 있으면 켠 시각과 무관하게 기록으로 판정한다', () => {
  // 방금 켰어도 기록이 낡았으면 죽음이다 — 대기가 낡은 기록을 가려선 안 된다
  const staleRecord = { atEpoch: base - 60 * minutes }
  const v = heartbeatVerdict(staleRecord, 15, base, base - 1 * minutes)
  assert.equal(v.waiting, false)
  assert.equal(v.alive, false)
  assert.match(v.why, /60분 전/)
})

test('대기 상태는 모든 판정 갈래에 있다 (없으면 화면이 undefined 를 본다)', () => {
  const branchSrc = [
    heartbeatVerdict(null, 15, base),
    heartbeatVerdict({}, 15, base),
    heartbeatVerdict({ atEpoch: base }, 15, base),
    heartbeatVerdict({ atEpoch: base - 60 * minutes }, 15, base),
    heartbeatVerdict({ atEpoch: base + 60 * minutes }, 15, base),
  ]
  for (const v of branchSrc) assert.equal(typeof v.waiting, 'boolean', JSON.stringify(v))
})
