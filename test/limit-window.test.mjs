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
import { learnBaseline, reconcileBaseline, windowView, WINDOWS } from '../src/lib/limit-window.mjs'

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
  /**
   * 🔴 보관은 **31일**이다(2026-09-29에 8일에서 늘렸다). 8일이면 «지금의 창» 은 재지만
   *   기준선을 배울 수 없다 — 제한 사건이 며칠 전이면 그 사건보다 7일 더 앞선 통이
   *   필요하기 때문이다. 실측으로 주간 사건이 11일 전이라 배우지 못했다.
   */
  putHour(acc, old + 20 * 24 * HOUR_MS, 1)
  assert.equal(windowSum(acc.hours, old - HOUR_MS, old + 2 * HOUR_MS), 10, '20일 전 기록은 아직 남아야 한다')
  putHour(acc, old + 32 * 24 * HOUR_MS, 1)
  assert.equal(windowSum(acc.hours, old - HOUR_MS, old + 2 * HOUR_MS), 0, '31일을 넘기면 버린다')
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

const q5 = (over = {}) => ({ rateLimitType: 'five_hour', status: 'rejected', _at: T - 2 * HOUR_MS, ...over })
const q7 = (over = {}) => ({ rateLimitType: 'seven_day', status: 'rejected', _at: T - 2 * HOUR_MS, ...over })
/** 🔴 **종류별로** 받는다 — 한 종류의 새 사건이 다른 종류의 배움을 지우면 안 된다 */
const byType = (...qs) => Object.fromEntries(qs.map((q) => [q.rateLimitType, q]))

test('🔴 제한에 걸린 순간의 창 합을 기준선으로 배운다 (그 순간이 100% 다)', () => {
  const hours = hoursAt([[6, 100], [4, 400], [3, 300], [1, 50]])
  const b = learnBaseline(hours, byType(q5()), {})
  // 제한 시각(T-2h) 기준 5시간 창 = [T-7h, T-2h) → 6·4·3시간 전이 들어온다
  assert.equal(b.session5h.tokens, 800)
  assert.equal(b.session5h.atEpoch, T - 2 * HOUR_MS)
  assert.equal(b.session5h.source, 'limit', '어디서 얻은 값인지 남겨야 한다')
})

/**
 * 🔴 **사용자가 물은 결함이 이것이다** (2026-09-29: 「weekly 사용량(%)이 왜 제대로 출력되지
 *   않는가」). 기록에는 `five_hour` 172건과 `seven_day` 7건이 있었는데, 우리는 «가장 최근
 *   한 건» 만 들고 있었다. 최근 것은 늘 five_hour 라 주간 사건이 통째로 가려졌고,
 *   주간 사용률은 영원히 「기준선 없음」이었다.
 */
test('🔴 주간 사건이 5시간 사건에 가려지지 않는다 (종류별로 배운다)', () => {
  const hours = hoursAt([[100, 900], [4, 400]])
  const b = learnBaseline(hours, byType(q5(), q7({ _at: T - 3 * HOUR_MS })), {})
  assert.ok(b.session5h, '5시간 기준선을 배워야 한다')
  assert.ok(b.weekly7d, '🔴 주간 기준선도 배워야 한다 — 가려지면 % 가 영원히 안 나온다')
  assert.ok(b.weekly7d.tokens >= 1300, `주간 창은 7일이므로 100시간 전 기록도 든다: ${b.weekly7d.tokens}`)
})

test('🔴 새 5시간 사건이 이미 배운 주간 기준선을 지우지 않는다', () => {
  const hours = hoursAt([[100, 900], [4, 400]])
  const learned = learnBaseline(hours, byType(q7({ _at: T - 3 * HOUR_MS })), {})
  const after = learnBaseline(hours, byType(q5({ _at: T })), learned)
  assert.deepEqual(after.weekly7d, learned.weekly7d, '다른 종류의 배움은 그대로 남아야 한다')
  assert.ok(after.session5h, '새 종류도 배워야 한다')
})

test('🔴 같은 사건으로 두 번 배우지 않는다 (덮어쓰면 창이 자라는 동안 기준선도 자란다)', () => {
  const hours = hoursAt([[4, 400]])
  const first = learnBaseline(hours, byType(q5()), {})
  const grown = hoursAt([[4, 400], [1, 900]])            // 그 뒤로 더 썼다
  const second = learnBaseline(grown, byType(q5()), first)
  assert.equal(second.session5h.tokens, first.session5h.tokens, '같은 시각의 사건은 한 번만')
})

test('새 제한 사건이 오면 **최근 것으로** 갈아친다 (요금제가 바뀌면 한도도 바뀐다)', () => {
  const hours = hoursAt([[4, 400], [1, 900]])
  const old = learnBaseline(hoursAt([[4, 400]]), byType(q5()), {})
  const next = learnBaseline(hours, byType(q5({ _at: T })), old)
  assert.notEqual(next.session5h.tokens, old.session5h.tokens)
  assert.equal(next.session5h.seen.length, 1, '옛 값도 남긴다 — 기준선이 흔들리는지 봐야 한다')
})

test('🔴 모르는 창 종류·시각 없는 기록으로는 배우지 않는다', () => {
  const hours = hoursAt([[1, 100]])
  assert.deepEqual(learnBaseline(hours, byType(q5({ rateLimitType: 'monthly' })), {}), {})
  assert.deepEqual(learnBaseline(hours, byType(q5({ _at: null })), {}), {})
  assert.deepEqual(learnBaseline(hours, null, {}), {})
  assert.deepEqual(learnBaseline(hours, {}, {}), {})
})

test('그 창에 우리 기록이 없으면 배우지 않는다 (다른 기기에서 쓴 것이다)', () => {
  const hours = hoursAt([[300, 500]])        // 창 밖의 기록뿐 (5시간·7일 창 모두 밖)
  assert.deepEqual(learnBaseline(hours, byType(q5()), {}), {})
})

/* ── 관측과 어긋나면 스스로 고친다 ──────────────────────────── */

/**
 * 🔴 실측(2026-09-29): 주간 기준선을 11일 전 사건에서 배우자 화면에 **215%** 가 떴다.
 *   그때 우리는 주간 제한에 걸려 있지 **않았다** — 「그 창을 넘겼는데 멀쩡하다」는 관측이
 *   기준선이 틀렸다는 증거다. 틀린 분모로 만든 백분율을 보여주면 사람이 그것으로 판단한다.
 */
test('🔴 제한 없이 기준선을 넘겼으면 기준선을 올린다 (100% 넘는 거짓말을 없앤다)', () => {
  const hours = hoursAt([[1, 2000]])
  const before = { session5h: { tokens: 1000, atEpoch: T - 99 * HOUR_MS, at: '옛날', source: 'limit' } }
  const after = reconcileBaseline(hours, before, { five_hour: false }, T)
  assert.equal(after.session5h.tokens, 2000, '넘긴 만큼이 새 하한선이다')
  assert.equal(after.session5h.source, 'survived', '출처가 바뀌어야 뜻도 바뀐다')
  assert.equal(after.session5h.seen.length, 1, '옛 기준선을 버리지 않는다')
  assert.equal(windowView('session5h', hours, after, T).pct, 100, '이제 100% 를 넘지 않는다')
})

test('🔴 지금 그 종류로 제한 중이면 올리지 않는다 (그때는 기준선이 맞고 창이 꽉 찬 것이다)', () => {
  const hours = hoursAt([[1, 2000]])
  const before = { session5h: { tokens: 1000, atEpoch: T - 99 * HOUR_MS, at: '옛날', source: 'limit' } }
  const after = reconcileBaseline(hours, before, { five_hour: true }, T)
  assert.equal(after.session5h.tokens, 1000, '제한 중이라면 넘긴 것이 아니다')
})

test('기준선보다 적게 썼으면 아무것도 바꾸지 않는다', () => {
  const hours = hoursAt([[1, 300]])
  const before = { session5h: { tokens: 1000, atEpoch: T, at: 'x', source: 'limit' } }
  assert.deepEqual(reconcileBaseline(hours, before, {}, T), before)
})

test('출처가 «넘긴 최대» 면 화면 문구가 «한도는 더 높다» 로 바뀐다', () => {
  const v = windowView('weekly7d', hoursAt([[1, 500]]),
    { weekly7d: { tokens: 500, at: '오늘', source: 'survived' } }, T)
  assert.equal(v.pct, 100)
  assert.match(v.why, /제한 없이 넘긴 가장 큰 창/)
  assert.match(v.why, /한도에 닿았다는 뜻이 아닙니다/, '🔴 100% 를 위험으로 읽게 두면 늑대 외치기다')
  assert.equal(v.baseline.from, '제한 없이 넘긴 최대 창')
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
