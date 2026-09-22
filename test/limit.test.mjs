/**
 * limit.test.mjs — 사용량 제한을 둘러싼 판정.
 *
 * 🔴 이 기능은 **사람이 보지 않는 동안 돈을 쓴다.** 규칙 하나하나에 시험을 붙인다.
 *
 * 사용자가 물은 것: "사용량 제한 해제 후, 감시 중인 세션을 재실행하는 것이 맞는가?"
 * 답한 원리:
 *   ① 제한 중에는 띄우지 않는다 (띄우면 실패로 기록돼 회로를 태운다)
 *   ② resetsAt 이 지난 뒤에만
 *   ③ 세션 프로세스가 꺼져 있을 때만 (기존 가드 그대로)
 *   ④ **제한에 잘려 멈춘** 세션만 — 놀고 있던 세션을 깨우지 않는다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { 제한상태, 제한실패인가, recordRun, budgetVerdict, 빈상태 } from '../src/lib/guard.mjs'
import { 제한알림인가, foldEntry, 빈누적 } from '../src/lib/sessions.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const 분 = 60_000
const 기준 = new Date('2026-09-22T12:00:00').getTime()
const 초 = (ms) => Math.round(ms / 1000)

/* ── ①② 제한 중인가 ────────────────────────────────────────── */

test('🔴 해제 시각이 미래면 제한 중이다 — 재개를 막는다', () => {
  const v = 제한상태({ resetsAt: 초(기준 + 90 * 분), rateLimitType: 'seven_day' }, 기준)
  assert.equal(v.제한중, true)
  assert.equal(v.남은분, 90)
  assert.match(v.why, /90분 후 해제/)
  assert.match(v.why, /회로를 태운다/, '왜 막는지 적어야 다음 사람이 되돌리지 않는다')
})

test('🔴 해제 시각이 지났으면 제한이 아니다 — 이제 이어갈 수 있다', () => {
  const v = 제한상태({ resetsAt: 초(기준 - 1 * 분) }, 기준)
  assert.equal(v.제한중, false)
  assert.equal(v.해제됨, true)
})

test('경계 — 해제 시각 정각은 이미 풀린 것으로 본다', () => {
  assert.equal(제한상태({ resetsAt: 초(기준) }, 기준).제한중, false)
})

/**
 * 🔴 여기서는 "모르면 막는다"를 쓰지 않는다.
 *   할당량 기록은 마지막으로 걸렸을 때 남은 것이고 새로 걸리기 전까지 남아 있다.
 *   해제 시각을 모른다고 막으면 그 기록 때문에 재개가 **영원히** 멎는다.
 *   끝이 없는 차단은 fail-open 만큼 나쁘다. 놓친 경우는 실행 결과가 받아낸다.
 */
test('🔴 할당량 기록이 없거나 해제 시각을 모르면 막지 않는다 (끝없는 차단 금지)', () => {
  for (const q of [null, undefined, {}, { resetsAt: null }, { resetsAt: 'x' }, { resetsAt: NaN }]) {
    assert.equal(제한상태(q, 기준).제한중, false, `${JSON.stringify(q)} 로 영구 차단되면 안 된다`)
  }
})

/* ── 제한 실패를 고장으로 세지 않는다 ───────────────────────── */

test('🔴 제한 때문에 실패한 회차는 연속실패를 올리지 않는다', () => {
  const s = { ...빈상태(), 연속실패: 2 }
  const n = recordRun(s, { 결과: '제한', 소요초: 3 }, { 연속실패한계: 3 }, 기준)
  assert.equal(n.연속실패, 2, '3 이 되면 회로가 차단된다 — 기다리면 될 일에')
  assert.equal(n.차단, null)
  assert.equal(budgetVerdict(n, { 연속실패한계: 3 }, 기준 + 60 * 분).ok, true)
})

test('🔴 그렇다고 성공도 아니다 — 연속실패를 0 으로 되돌리지 않는다', () => {
  const s = { ...빈상태(), 연속실패: 2 }
  const n = recordRun(s, { 결과: '제한', 소요초: 3 }, { 연속실패한계: 3 }, 기준)
  assert.equal(n.연속실패, 2, '진짜 실패 2회가 제한 한 번으로 지워지면 안 된다')
})

test('제한도 하루 횟수에는 센다 (프로세스를 띄웠으니 시도는 시도다)', () => {
  const n = recordRun(빈상태(), { 결과: '제한', 소요초: 3 }, {}, 기준)
  assert.equal(n.일별['2026-09-22'], 1)
})

test('진짜 실패는 여전히 연속실패를 올린다', () => {
  const n = recordRun({ ...빈상태(), 연속실패: 2 }, { 결과: 'fail', 소요초: 3 }, { 연속실패한계: 3 }, 기준)
  assert.equal(n.연속실패, 3)
  assert.ok(n.차단, '진짜 고장은 차단되어야 한다')
})

test('제한실패인가 — 제한 문구를 알아본다', () => {
  assert.equal(제한실패인가("You've hit your session limit · resets 1:30pm"), true)
  assert.equal(제한실패인가('Error: usage limit reached'), true)
  assert.equal(제한실패인가('rate limit exceeded, resets later'), true)
})

test('🔴 제한실패인가 — 모르면 false (진짜 고장을 제한으로 감추지 않는다)', () => {
  for (const s of ['', null, undefined, 'ENOENT', 'permission denied', 'limit']) {
    assert.equal(제한실패인가(s), false, `${JSON.stringify(s)} 를 제한으로 보면 고장이 묻힌다`)
  }
})

/* ── ④ 제한에 잘려 멈췄나 ──────────────────────────────────── */

const 합성 = (글) => ({ model: '<synthetic>', content: [{ type: 'text', text: 글 }] })

test('🔴 제한 알림을 알아본다 (실측 표본)', () => {
  assert.equal(제한알림인가(합성("You've hit your session limit · resets 1:30pm (Asia/Seoul)")), true)
  assert.equal(제한알림인가(합성('You have reached your weekly usage limit')), true)
})

test('🔴 제한 알림이 아닌 것을 제한이라 하지 않는다 (놀던 세션을 깨운다)', () => {
  assert.equal(제한알림인가(합성('API Error: connection reset')), false, 'reset 만으로는 제한이 아니다')
  assert.equal(제한알림인가({ model: 'claude-opus-5', content: [{ type: 'text', text: 'usage limit' }] }), false,
    '진짜 모델의 답에 그 말이 나와도 제한 알림이 아니다')
  for (const x of [null, undefined, {}, { model: '<synthetic>' }]) {
    assert.equal(제한알림인가(x), false)
  }
})

test('🔴 마지막 엔트리가 제한 알림일 때만 "제한으로 멈춤" 이다', () => {
  const acc = 빈누적('s', 'slug')
  foldEntry(acc, { type: 'assistant', message: { model: 'claude-opus-5', content: [] }, timestamp: '2026-09-22T11:00:00Z' })
  assert.equal(acc.제한으로멈춤, false)

  foldEntry(acc, { type: 'assistant', message: 합성("You've hit your session limit · resets 1:30pm"), timestamp: '2026-09-22T11:30:00Z' })
  assert.equal(acc.제한으로멈춤, true, '제한에 잘린 채 멈춰 있다')
  assert.ok(acc.제한알림at, '언제 잘렸는지도 남겨야 한다')
})

test('🔴 제한 뒤에 작업이 이어졌으면 "멈춤"이 아니다 (실측: 이 PC 의 두 세션)', () => {
  const acc = 빈누적('s', 'slug')
  foldEntry(acc, { type: 'assistant', message: 합성("You've hit your session limit"), timestamp: '2026-09-18T11:29:00Z' })
  assert.equal(acc.제한으로멈춤, true)

  // 제한이 풀린 뒤 사람이 이어서 썼다
  foldEntry(acc, { type: 'user', message: { content: '계속하자' }, timestamp: '2026-09-19T20:00:00Z' })
  assert.equal(acc.제한으로멈춤, false, '이미 이어졌는데 또 깨우면 안 된다')
  assert.ok(acc.제한알림at, '겪었다는 사실은 남는다 — 멈춰 있다와는 다르다')
})

/* ── 재개가 실제로 이 규칙들을 쓰는가 ──────────────────────── */

// 지시문은 lib/prompt.mjs 로 옮겼다(resume.mjs 가 400줄을 넘어서). 둘을 함께 본다 —
// '화면이 무엇을 한다'를 확인하려는 것이지 '어느 파일에 있다'를 보려는 게 아니다.
const 재개소스 = ['src/resume.mjs', 'src/lib/prompt.mjs']
  .map((f) => readFileSync(join(ROOT, ...f.split('/')), 'utf8')).join(String.fromCharCode(10))
const 재개코드 = 재개소스.split('\n')
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
  .join('\n')

test('🔴 제한 중이면 FORCE 로도 막힌다 (억지로 밀 이유가 없다)', () => {
  const i = 재개코드.indexOf('제한상태(')
  assert.ok(i > 0, '재개가 제한상태를 써야 한다')
  const 앞 = 재개코드.slice(Math.max(0, i - 300), i)
  assert.ok(!/if \(!FORCE\) \{[^}]*$/.test(앞), '제한 확인이 !FORCE 블록 안에 들어가면 안 된다')
  assert.match(재개코드, /if \(제한\.제한중\) return stop\(제한\.why\)/)
})

test('🔴 제한에 잘린 세션은 추적기·재개지시가 없어도 재개 지점으로 인정한다', () => {
  assert.match(재개코드, /const 제한중단 = !!s\.제한으로멈춤/)
  assert.match(재개코드, /else if \(!대상\.재개지시 && !제한중단\)/,
    '제한중단이면 "재개 지점 없음" 으로 막지 않아야 한다')
})

test('🔴 지시문이 "제한에 끊겼다"를 세션에 알려준다', () => {
  assert.match(재개코드, /제한중단: v\.제한중단/, '판정 결과를 지시문에 넘겨야 한다')
  assert.match(재개소스, /사용량 제한에 걸려 중간에 끊겼다/, '무엇 때문에 끊겼는지 말해야 한다')
  assert.match(재개소스, /이미 끝난 일이었다면 아무것도 하지 말고/,
    '이미 끝났으면 멈추라고 해야 한다 — 없으면 할 일 없이도 일을 만든다')
})

test('🔴 제한 결과는 스케줄러 이력을 빨갛게 물들이지 않는다', () => {
  assert.match(재개코드, /결과 !== 'ok' && 결과 !== '제한'/, '제한은 exit 1 이 아니다')
})

test('실행 중 확인은 그대로 남아 있다 (③ — 세션이 열려 있으면 안 민다)', () => {
  assert.match(재개코드, /const 실행 = 세션실행중\(/)
  assert.match(재개코드, /if \(실행\.실행중\) return stop\(실행\.why\)/)
})
