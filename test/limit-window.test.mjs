/**
 * limit-window.test.mjs — **「Session (5hr)」·「Weekly (7 day)」 를 정직하게 세는가.**
 *
 * 🔴 이 기능의 위험은 계산이 아니라 **출처**다 (실측 2026-09-29)
 *   공식 백분율은 대화 안의 `/usage` 화면에만 있다. 헤드리스(`claude -p /usage`)는 본문만
 *   주고, 트랜스크립트의 `quotaLimits` 에는 사용률 칸이 아예 없고, `claude auth status`
 *   에도 없다(전수 확인). 그래서 우리가 재고 **우리가 잰 것이라고 말해야** 한다.
 *
 *   분모는 **제한에 실제로 걸린 순간**의 같은 창이다(그 순간이 100%). 그 사건이 없으면
 *   퍼센트를 만들지 않는다 — 분모를 지어내면 「여유 있다」가 거짓이 되고, 사람이 그 숫자로
 *   일을 계획한다. 이 시험은 그 «만들지 않음» 을 못박는 것이 목적이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { putHour, windowSum, mergeHours, hourKey, HOUR_MS } from '../src/lib/hours.mjs'
import { learnBaseline, windowView, WINDOWS } from '../src/lib/limit-window.mjs'

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
  putHour(acc, T + 59 * 60_000, 5)          // 같은 시간 안
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
  // 지난달 기록만 있는 세션을 처음 접는 경우 — now 기준으로 버리면 통째로 사라진다
  const old = new Date('2026-08-01T00:00:00').getTime()
  putHour(acc, old, 7)
  putHour(acc, old + HOUR_MS, 3)
  assert.equal(windowSum(acc.hours, old - HOUR_MS, old + 2 * HOUR_MS), 10)
  // 8일보다 더 오래된 것은 새 통이 들어올 때 빠진다
  putHour(acc, old + 9 * 24 * HOUR_MS, 1)
  assert.equal(windowSum(acc.hours, old - HOUR_MS, old + 2 * HOUR_MS), 0)
})

test('창 합은 [from, to) 다 — 경계 통은 **넣는다**(적게 보이는 쪽으로 기울지 않는다)', () => {
  const hours = hoursAt([[6, 100], [4, 50], [1, 25]])
  assert.equal(windowSum(hours, T - 5 * HOUR_MS, T), 75, '5시간 창은 4시간·1시간 전만')
  assert.equal(windowSum(hours, T - 7 * HOUR_MS, T), 175, '7시간이면 셋 다')
})

test('여러 세션의 통을 합친다 (창은 계정 단위로 묻는다)', () => {
  const a = hoursAt([[1, 10]]), b = hoursAt([[1, 5], [3, 7]])
  const m = mergeHours([a, b])
  assert.equal(windowSum(m, T - 5 * HOUR_MS, T), 22)
})

/* ── 기준선 배우기 ──────────────────────────────────────────── */

const quota = (over = {}) => ({ rateLimitType: 'five_hour', status: 'rejected', _at: T - 2 * HOUR_MS, ...over })

test('🔴 제한에 걸린 순간의 창 합을 기준선으로 배운다 (그 순간이 100% 다)', () => {
  const hours = hoursAt([[6, 100], [4, 400], [3, 300], [1, 50]])
  const b = learnBaseline(hours, quota(), {})
  // 제한 시각(T-2h) 기준 5시간 창 = [T-7h, T-2h) → 6·4·3시간 전이 들어온다
  assert.equal(b.session5h.tokens, 800)
  assert.equal(b.session5h.atEpoch, T - 2 * HOUR_MS)
})

test('🔴 같은 사건으로 두 번 배우지 않는다 (덮어쓰면 창이 자라는 동안 기준선도 자란다)', () => {
  const hours = hoursAt([[4, 400]])
  const first = learnBaseline(hours, quota(), {})
  const grown = hoursAt([[4, 400], [1, 900]])            // 그 뒤로 더 썼다
  const second = learnBaseline(grown, quota(), first)
  assert.equal(second.session5h.tokens, first.session5h.tokens, '같은 시각의 사건은 한 번만')
})

test('새 제한 사건이 오면 **최근 것으로** 갈아친다 (요금제가 바뀌면 한도도 바뀐다)', () => {
  const hours = hoursAt([[4, 400], [1, 900]])
  const old = learnBaseline(hoursAt([[4, 400]]), quota(), {})
  const next = learnBaseline(hours, quota({ _at: T }), old)
  assert.notEqual(next.session5h.tokens, old.session5h.tokens)
  assert.equal(next.session5h.seen.length, 1, '옛 값도 남긴다 — 기준선이 흔들리는지 봐야 한다')
})

test('🔴 모르는 창 종류·시각 없는 기록으로는 배우지 않는다', () => {
  const hours = hoursAt([[1, 100]])
  assert.deepEqual(learnBaseline(hours, quota({ rateLimitType: 'monthly' }), {}), {})
  assert.deepEqual(learnBaseline(hours, quota({ _at: null }), {}), {})
  assert.deepEqual(learnBaseline(hours, null, {}), {})
})

test('그 창에 우리 기록이 없으면 배우지 않는다 (다른 기기에서 쓴 것이다)', () => {
  const hours = hoursAt([[100, 500]])        // 창 밖의 기록뿐
  assert.deepEqual(learnBaseline(hours, quota(), {}), {})
})

/* ── 보여주기 ───────────────────────────────────────────────── */

test('기준선이 있으면 퍼센트를 만든다 (실측 ÷ 기준선)', () => {
  const hours = hoursAt([[2, 250]])
  const v = windowView('session5h', hours, { session5h: { tokens: 1000, at: '어제' } }, T)
  assert.equal(v.tokens, 250)
  assert.equal(v.pct, 25)
  assert.match(v.why, /최소값/, '🔴 로컬 세션만 보므로 최소값이라고 말해야 한다')
})

test('🔴 기준선이 없으면 pct 는 null 이고 **왜 없는지** 말한다 (빈칸은 고장으로 읽힌다)', () => {
  const v = windowView('weekly7d', hoursAt([[2, 250]]), {}, T)
  assert.equal(v.pct, null)
  assert.equal(v.tokens, 250, '% 가 없어도 절대량은 준다')
  assert.match(v.why, /기준선이 없습니다/)
  assert.match(v.why, /실제로 걸린 기록이 있어야/, '어떻게 하면 생기는지 적어야 한다')
})

test('창 이름은 `/usage` 화면의 말 그대로다 (사람이 본 단어로 찾는다)', () => {
  assert.equal(WINDOWS.session5h.label, 'Session (5hr)')
  assert.equal(WINDOWS.weekly7d.label, 'Weekly (7 day)')
  assert.equal(WINDOWS.session5h.ms, 5 * HOUR_MS)
  assert.equal(WINDOWS.weekly7d.ms, 7 * 24 * HOUR_MS)
})

test('퍼센트는 100 을 넘을 수 있다 (한도를 넘겨 쓴 것을 100 으로 깎지 않는다)', () => {
  const v = windowView('session5h', hoursAt([[1, 2000]]), { session5h: { tokens: 1000, at: 'x' } }, T)
  assert.equal(v.pct, 200)
})
