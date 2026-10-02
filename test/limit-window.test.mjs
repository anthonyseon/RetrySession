/**
 * limit-window.test.mjs — **창의 실측 몫과, 공식 값과 묶는 방법.**
 *
 * 🔴 여기서 백분율을 만들지 않는다 (사용자 지적 2026-09-29)
 *   예전에는 «실측 ÷ 제한 사건에서 배운 기준선» 으로 퍼센트를 추정했다. 그런데 사용자가
 *   대화 안 `/usage` 에서 본 값은 `Session 7% · Weekly 40%` 였고 화면은 **100%** 를 보여줬다.
 *   한도의 단위도 창의 시작점도 우리가 모르니 추정으로는 맞출 수 없다 — 그 기계를 걷어냈다.
 *   퍼센트는 공식 값을 받아 쓴다(`lib/oauth-usage.mjs` · `test/oauth-usage.test.mjs`).
 *
 *   남은 책임은 둘이다: ① 굴러가는 창의 **실측 토큰** ② 공식 값과 실측을 **한 줄로 묶기.**
 *   🔴 그 둘을 **나누지 않는다.** 단위가 다른 값을 나누면 그게 다시 추정이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { putHour, windowSum, mergeHours, hourKey, HOUR_MS } from '../src/lib/hours.mjs'
import { measuredWindows, joinWindows, WINDOWS } from '../src/lib/limit-window.mjs'

const T = new Date('2026-09-29T09:00:00').getTime()
const hoursAt = (pairs) => {
  const acc = { hours: {} }
  for (const [hoursAgo, tok] of pairs) putHour(acc, T - hoursAgo * HOUR_MS, tok)
  return acc.hours
}

/* ── 시간 통 ─────────────────────────────────────────────────── */

test('통 이름은 시각을 시간으로 내린 값이다 (같은 시간은 한 통에 모인다)', () => {
  const acc = { hours: {} }
  putHour(acc, T, 10)
  putHour(acc, T + 59 * 60_000, 5)
  assert.deepEqual(Object.keys(acc.hours), [String(hourKey(T))])
  assert.equal(acc.hours[hourKey(T)], 15)
})

test('🔴 시각이 없거나 토큰이 0 이면 통을 만들지 않는다 (모르는 것을 지금으로 몰면 창이 부푼다)', () => {
  const acc = { hours: {} }
  putHour(acc, NaN, 100)
  putHour(acc, undefined, 100)
  putHour(acc, T, 0)
  assert.deepEqual(acc.hours, {})
})

test('🔴 오래된 통은 버리되 기준은 **통에 든 가장 늦은 시각**이다 (옛 기록도 접을 수 있어야 한다)', () => {
  const acc = { hours: {} }
  const old = new Date('2026-08-01T00:00:00').getTime()
  putHour(acc, old, 7)
  putHour(acc, old + HOUR_MS, 3)
  assert.equal(windowSum(acc.hours, old - HOUR_MS, old + 2 * HOUR_MS), 10)
  // 보관은 **9일**이다 — 7일 창 + 여유 이틀. 그 이상은 아무도 읽지 않는다(추정 기계를 걷어냈다)
  putHour(acc, old + 8 * 24 * HOUR_MS, 1)
  assert.equal(windowSum(acc.hours, old - HOUR_MS, old + 2 * HOUR_MS), 10, '8일 전 기록은 아직 남아야 한다')
  putHour(acc, old + 10 * 24 * HOUR_MS, 1)
  assert.equal(windowSum(acc.hours, old - HOUR_MS, old + 2 * HOUR_MS), 0, '9일을 넘기면 버린다')
})

test('창 합은 [from, to) 다 — 경계 통은 **넣는다**(적게 보이는 쪽으로 기울지 않는다)', () => {
  const hours = hoursAt([[6, 100], [4, 50], [1, 25]])
  assert.equal(windowSum(hours, T - 5 * HOUR_MS, T), 75, '5시간 창은 4시간·1시간 전만')
  assert.equal(windowSum(hours, T - 7 * HOUR_MS, T), 175, '7시간이면 셋 다')
})

test('여러 세션의 통을 합친다 (창은 계정 단위로 묻는다)', () => {
  const m = mergeHours([hoursAt([[1, 10]]), hoursAt([[1, 5], [3, 7]])])
  assert.equal(windowSum(m, T - 5 * HOUR_MS, T), 22)
})

/* ── 실측 창 ─────────────────────────────────────────────────── */

test('창 이름과 길이는 `/usage` 화면의 말 그대로다 (사람이 본 단어로 찾는다)', () => {
  assert.equal(WINDOWS.session5h.label, 'Session (5hr)')
  assert.equal(WINDOWS.weekly7d.label, 'Weekly (7 day)')
  assert.equal(WINDOWS.session5h.ms, 5 * HOUR_MS)
  assert.equal(WINDOWS.weekly7d.ms, 7 * 24 * HOUR_MS)
})

test('실측 창은 굴러가는 창이다 (지금부터 거꾸로 5시간·7일)', () => {
  const [s, w] = measuredWindows(hoursAt([[2, 300], [50, 700]]), T)
  assert.equal(s.tokens, 300, '5시간 창에는 2시간 전 것만')
  assert.equal(w.tokens, 1000, '7일 창에는 둘 다')
  assert.match(s.windowFrom, /2026-09-29 04:00:00/)
  assert.match(s.windowTo, /2026-09-29 09:00:00/)
})

test('🔴 실측 창에는 퍼센트가 없다 (여기서 만들면 그게 추정이다)', () => {
  for (const w of measuredWindows(hoursAt([[1, 10]]), T)) {
    assert.ok(!('pct' in w), `${w.key} 에 pct 가 들어왔다 — 퍼센트는 공식 값만 쓴다`)
    assert.ok(!('baseline' in w), `${w.key} 에 기준선이 돌아왔다 — 걷어낸 기계다`)
  }
})

/* ── 공식 값과 묶기 ─────────────────────────────────────────── */

const official = [
  { key: 'session5h', label: 'Session (5hr)', pct: 9, resetsAt: '2026-09-29 17:59:59', resetsInMin: 290, severity: 'normal', lockedReason: null },
  { key: 'weekly7d', label: 'Weekly (7 day)', pct: 41, resetsAt: '2026-10-03 18:59:59', resetsInMin: 6110, severity: 'normal', lockedReason: null },
]

test('공식 퍼센트와 우리 실측 토큰이 한 줄에 묶인다', () => {
  const rows = joinWindows(official, hoursAt([[2, 300], [50, 700]]), T)
  const s = rows.find((r) => r.key === 'session5h')
  assert.equal(s.pct, 9, '퍼센트는 공식 값 그대로다')
  assert.equal(s.resetsAt, '2026-09-29 17:59:59', '초기화 시각도 그쪽 값이다')
  assert.equal(s.measured.tokens, 300, '실측은 옆에 붙는다(참고)')
})

test('🔴 공식 값이 없으면 pct 는 null 이다 — 실측으로 메우지 않는다', () => {
  const rows = joinWindows([], hoursAt([[2, 300]]), T)
  for (const r of rows) {
    assert.equal(r.pct, null, `${r.key}: 못 받은 것을 숫자로 채우면 사람이 그것을 믿는다`)
    assert.equal(r.resetsAt, null)
    assert.ok(r.measured.tokens >= 0, '실측은 그대로 보여준다')
  }
})

test('공식 값에만 있는 창도 빠뜨리지 않는다 (그쪽이 창을 늘릴 수 있다)', () => {
  const extra = [...official, { key: 'weekly_opus', label: 'Weekly (Opus)', pct: 12, resetsAt: null, resetsInMin: null, severity: 'normal' }]
  const rows = joinWindows(extra, {}, T)
  assert.ok(rows.find((r) => r.key === 'weekly_opus'), '모르는 창이라고 버리면 화면이 거짓이 된다')
  assert.equal(rows.find((r) => r.key === 'weekly_opus').measured, null, '실측이 없으면 null 이다')
})

test('그쪽이 준 severity 를 그대로 들고 온다 (경고 기준을 우리가 발명하지 않는다)', () => {
  const rows = joinWindows([{ ...official[0], severity: 'critical' }], {}, T)
  assert.equal(rows[0].severity, 'critical')
})
