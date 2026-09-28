/**
 * overload.test.mjs — API 과부하·서버 오류는 **우리 실패가 아니다.**
 *
 * 🔴 왜 따로 있나
 *   제한이 차단기를 태우는 사고는 이미 고쳤는데(guard.test.mjs), **같은 사고의 다른
 *   얼굴**인 과부하는 막지 않고 있었다. 529 는 isLimitFailure 에 안 걸려 'fail' 이 되고,
 *   'fail' 세 번이면 회로가 차단되어 사람이 --rearm 할 때까지 재개가 멎는다.
 *   문구는 지어내지 않고 트랜스크립트 800파일·106,329줄에서 실측했다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTransientFailure } from '../src/lib/classify.mjs'
import { recordRun, emptyState } from '../src/lib/guard.mjs'

/**
 * 🔴 실측 결함 (2026-09-22): 529 는 isLimitFailure 에 안 걸려 'fail' 이 됐고,
 *   'fail' 세 번이면 회로가 차단된다. Anthropic 쪽이 45분 흔들리면 우리 차단기가
 *   내려가고, 사람이 --rearm 할 때까지 재개가 멎는다. 제한에서 이미 고친 실수다.
 *
 *   문구는 트랜스크립트 800파일·106,329줄에서 **실측한 것**만 쓴다.
 */
test('🔴 과부하·서버 오류는 지나가는 실패다', () => {
  const real = 'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment. If it persists, check https://status.claude.com.'
  assert.equal(isTransientFailure(real), true, '실측된 529 문구를 못 알아본다')
  for (const s of ['API Error: 500', 'API Error: 502 Bad Gateway', 'API Error: 503',
    'API Error: 504', 'API Error: 429', 'Server is temporarily limiting requests']) {
    assert.equal(isTransientFailure(s), true, `${s} 는 지나가는 실패다`)
  }
})

test('🔴 고칠 때까지 계속 실패할 것은 지나가는 실패가 아니다 (영원히 재시도하면 안 된다)', () => {
  // 실측: 이 400 은 10회 나왔다. 지나가는 것으로 봤다면 하루 12회를 계속 태웠을 것이다.
  const real = "API Error: 400 tools.11.custom.input_schema.properties: Property keys should match pattern '^[a-zA-Z0-9_.-]{1,64}$'"
  assert.equal(isTransientFailure(real), false, '스키마 오류를 재시도하면 하루 상한만 태운다')
  for (const s of ['API Error: 401', 'API Error: 403', 'API Error: 404', 'API Error: 422']) {
    assert.equal(isTransientFailure(s), false, `${s} 는 재시도로 안 풀린다`)
  }
})

test('모를 때는 지나가는 실패라고 하지 않는다', () => {
  for (const s of ['', null, undefined, 'No conversation found with session ID: …', '알 수 없는 오류']) {
    assert.equal(isTransientFailure(s), false, `${JSON.stringify(s)} 를 과부하로 읽으면 안 된다`)
  }
})

test('🔴 과부하는 연속실패를 올리지 않는다 (차단기를 태우지 않는다)', () => {
  let st = emptyState()
  for (let i = 0; i < 5; i++) st = recordRun(st, { result: 'overload', summary: '529' }, { failStreakMax: 3 })
  assert.equal(st.failStreak, 0, '과부하 다섯 번에 차단되면 안 된다')
  assert.equal(st.blocked, null)
})

test('🔴 그렇다고 연속실패를 0 으로 되돌리지도 않는다 (진짜 실패는 남아야 한다)', () => {
  let st = emptyState()
  st = recordRun(st, { result: 'fail', summary: 'x' }, { failStreakMax: 3 })
  st = recordRun(st, { result: 'fail', summary: 'x' }, { failStreakMax: 3 })
  st = recordRun(st, { result: 'overload', summary: '529' }, { failStreakMax: 3 })
  assert.equal(st.failStreak, 2, '과부하가 끼었다고 진짜 실패 두 번이 지워지면 안 된다')
  st = recordRun(st, { result: 'fail', summary: 'x' }, { failStreakMax: 3 })
  assert.ok(st.blocked, '세 번째 진짜 실패에서는 차단돼야 한다')
})

test('과부하도 세기는 센다 (몇 번 막혔는지 모르면 왜 안 도는지 안 보인다)', () => {
  let st = emptyState()
  st = recordRun(st, { result: 'overload', summary: '529' }, {})
  st = recordRun(st, { result: 'overload', summary: '529' }, {})
  const today = Object.keys(st.overloadByDay)[0]
  assert.equal(st.overloadByDay[today], 2)
  assert.equal(Object.values(st.byDay)[0], 2, '하루 횟수에도 센다 — 프로세스를 띄웠다')
})

test('옛 기록의 한글 결과값도 받아 준다 (기록을 버리지 않는다)', () => {
  let st = emptyState()
  st = recordRun(st, { result: '제한', summary: 'old' }, { failStreakMax: 3 })
  assert.equal(st.failStreak, 0, "옛 '제한' 기록이 실패로 세어지면 안 된다")
})
