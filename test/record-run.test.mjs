/**
 * record-run.test.mjs — **회차 기록과 회로 차단기**를 고정한다 (guard.recordRun · rearm).
 *
 * 🔴 왜 guard.test.mjs 에서 갈랐나 — 그 파일이 440줄이 됐다(규칙 400). 넘긴 자리가 쪼갤
 *   자리라는 규칙 그대로다. 여기 모은 것은 한 관심사다: **한 회차의 결과를 어떻게 세는가.**
 *
 * 이 파일의 시험들은 대부분 실측 사고에서 왔다(각 시험의 주석 참고):
 *   · 성공했는데 차단이 남아 그 뒤 예약 회차가 전부 건너뛰어졌다 (2026-09-29)
 *   · 일하는 중에 자른 회차를 «우리 실패» 로 세어 회로를 태웠다 (2026-09-28)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { budgetVerdict, recordRun, rearm, emptyState } from '../src/lib/guard.mjs'

const base = new Date('2026-09-18T12:00:00').getTime()
const cfg = { minGapMin: 30, maxPerDay: 3, maxCostUSDPerDay: 5, failStreakMax: 3 }

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

/**
 * 🔴 **타임아웃은 우리 실패가 아니다** (실측 2026-09-28, 결정 2026-09-29).
 *
 *   `timeout · 1801초 · $0` 세 회차가 연속 3회로 회로를 차단했다. 그런데 트랜스크립트를
 *   재 보니 세 회차 모두 **kill 직전까지 초 단위로 도구가 돌고 있었다**(도구 56·58·75회 ·
 *   캐시읽기 56.7M·58.7M·102.4M — 성공 회차의 1.5~3배). 멈춘 것이 아니라 일이 회차보다
 *   컸다. 우리 인내심이 짧은 것을 «고장» 으로 세면, 가장 많이 일한 회차가 도구를 멈춘다.
 *
 *   차단하지 않는 대신 **세어서 말한다** — `timeoutByDay` + 경보(하루 2회부터).
 */
test('🔴 기록 — timeout 은 연속실패를 올리지 않는다 (일하는 중에 자른 것일 수 있다)', () => {
  const n = recordRun(emptyState(), { result: 'timeout', tookSec: 1800 }, cfg, base)
  assert.equal(n.failStreak, 0, '타임아웃으로 회로를 태우면 안 된다')
  assert.equal(n.timeoutByDay['2026-09-18'], 1, '차단하지 않는 대신 세어야 한다')
  assert.equal(n.byDay['2026-09-18'], 1, '하루 횟수에는 센다 — 프로세스를 띄웠으니 시도는 시도다')
})

test('🔴 기록 — 진짜 실패 뒤의 타임아웃이 연속실패를 **0 으로 되돌리지도** 않는다', () => {
  const s = { ...emptyState(), failStreak: 2 }
  const n = recordRun(s, { result: 'timeout', tookSec: 1800 }, cfg, base)
  assert.equal(n.failStreak, 2, '실패 두 번은 그대로 남아야 한다 (성공만 0 으로 되돌린다)')
})

/**
 * 🔴 **성공하면 차단을 푼다** (실측 결함 2026-09-29).
 *
 *   `ok · 590초 · 턴 17` 로 끝낸 뒤에도 `차단 🔴 연속 3회 실패` 가 남아, 그 뒤의 예약
 *   회차가 전부 `회로 차단됨` 으로 건너뛰어졌다 — 증명된 멀쩡한 도구가 조용히 죽어 있었다.
 *   차단 중에 도는 회차는 사람이 띄운 것뿐이므로(`--now`·`--force`) 그 성공은 증거다.
 */
test('🔴 기록 — 성공하면 회로 차단을 푼다 (--rearm 을 기다리지 않는다)', () => {
  const s = { ...emptyState(), failStreak: 3, blocked: { at: '2026-09-28 20:03:14', reason: '연속 3회 실패' } }
  const n = recordRun(s, { result: 'ok', tookSec: 590, costUSD: 15.9 }, cfg, base)
  assert.equal(n.failStreak, 0)
  assert.equal(n.blocked, null, '성공했는데 차단이 남으면 다음 예약 회차가 전부 건너뛴다')
})

test('🔴 기록 — 성공이 아니면 차단은 그대로 남는다 (제한·타임아웃으로 풀리지 않는다)', () => {
  for (const result of ['limited', 'timeout', 'overload', 'auth', 'fail']) {
    const s = { ...emptyState(), failStreak: 3, blocked: { at: 'x', reason: '연속 3회 실패' } }
    const n = recordRun(s, { result, tookSec: 10 }, cfg, base)
    assert.ok(n.blocked, `${result}: 성공이 아닌 회차가 차단을 풀면 안 된다`)
  }
})

test('--rearm 은 차단과 연속실패를 푼다', () => {
  const s = { ...emptyState(), failStreak: 5, blocked: { at: 'x', reason: 'y' }, byDay: { '2026-09-18': 2 } }
  const n = rearm(s)
  assert.equal(n.failStreak, 0)
  assert.equal(n.blocked, null)
  assert.equal(n.byDay['2026-09-18'], 2, '하루 횟수는 남긴다 — 예산은 풀지 않는다')
  assert.equal(budgetVerdict(n, cfg, base).ok, true)
})
