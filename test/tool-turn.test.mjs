/**
 * tool-turn.test.mjs — **도구 결과를 「사람 차례」로 읽지 않는다.**
 *
 * 🔴 실측 결함 (2026-09-28)
 *   Claude Code 기록에서 **도구 결과는 `type:"user"` 엔트리로** 들어온다. 그래서 우리가
 *   타임아웃으로 죽인 회차의 마지막 도구 결과가 「마지막 차례가 사람이다 — 답이 아직
 *   나오지 않았으므로 일하는 중이다」로 읽혔다. 사람은 아무 말도 하지 않았는데,
 *   그 세션은 **다음 타임아웃분(30분) 동안** 재개 대상에서 빠졌다.
 *
 *   측정으로 확인한 모양 — 19:03:12 에 `user(tool_result)` 로 끊기고, 다음 회차가 정확히
 *   **30.1분** 뒤에 돌았다(=`timeoutMin` 낡음 탈출이 열어 준 시각). 그 사이 SKIP 들은
 *   전부 「마지막 차례가 사람이다」였다.
 *
 *   살아 있는 모델은 도구 결과가 오면 몇 초 안에 다음 줄을 남긴다. 그러니 결과 뒤 몇 분이
 *   조용하면 그 회차는 죽은 것이고, 그때가 이어받을 자리다.
 *
 * 부수 효과도 함께 못박는다: `userMsgs` 가 도구 결과까지 세면 「사람 메시지 2031」처럼
 *   부푼다. 화면이 그 숫자를 사람의 입력 수로 보여주면 거짓이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyTotals, foldEntry } from '../src/lib/session-fold.mjs'
import { resumeGate, GATE } from '../src/lib/resume-gate.mjs'

const at = '2026-09-18T01:00:00.000Z'
const toolResult = (id = 't1') => ({
  type: 'user', timestamp: at,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
})
const humanSays = (text = '이어서 해라') => ({
  type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'text', text }] },
})

/* ── 접기: 셋을 가른다 ───────────────────────────────────────── */

test('🔴 도구 결과는 lastKind 를 tool 로 만든다 (사람이 아니다)', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, toolResult())
  assert.equal(acc.lastKind, 'tool')
  assert.equal(acc.userMsgs, 0, '도구 결과를 사람 메시지로 세면 숫자가 부푼다')
  assert.equal(acc.toolResults, 1)
})

test('사람이 글로 입력하면 lastKind 는 user 다', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, humanSays())
  assert.equal(acc.lastKind, 'user')
  assert.equal(acc.userMsgs, 1)
  assert.equal(acc.toolResults, 0)
})

test('문자열 내용(옛 모양)도 사람으로 본다 — 모르면 사람 쪽으로 기운다', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, { type: 'user', timestamp: at, message: { role: 'user', content: '그대로 해' } })
  assert.equal(acc.lastKind, 'user')
  assert.equal(acc.userMsgs, 1)
})

test('도구 결과와 글이 **섞인** 엔트리는 사람으로 본다 (사람이 덧붙였을 수 있다)', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, {
    type: 'user', timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }, { type: 'text', text: '잠깐' }] },
  })
  assert.equal(acc.lastKind, 'user')
})

test('도구 결과가 오면 미완결 목록에서 빠진다 (이 성질은 그대로다)', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, {
    type: 'assistant', timestamp: at,
    message: { model: 'm', usage: {}, content: [{ type: 'tool_use', id: 't9', name: 'Bash', input: {} }] },
  })
  assert.equal(acc.pendingTools.length, 1)
  foldEntry(acc, toolResult('t9'))
  assert.equal(acc.pendingTools.length, 0)
  assert.equal(acc.lastKind, 'tool')
})

/* ── 판정: 짧게 기다리고 넘어간다 ───────────────────────────── */

const project = (over = {}) => ({
  id: 'P', repo: 'c:\\r',
  resume: { enabled: true, maxPerDay: 12, minGapMin: 30, failStreakMax: 3, sessionActiveMin: 3, timeoutMin: 60, quietHours: null, ...over },
})
const gate = (session) => resumeGate({
  target: { restart: true, resumePrompt: '이어라' },
  project: project(),
  state: { byDay: {}, costByDay: {}, failStreak: 0, blocked: null },
  session: { openTools: 0, lastKind: 'tool', stoppedByLimit: false, stoppedByInterrupt: false, quota: null, ...session },
  tracker: { exists: false },
})

test('🔴 도구 결과 직후(5분 안)는 일하는 중으로 본다 — 모델이 이어서 답하는 중이다', () => {
  const v = gate({ activeMin: 1 })
  assert.equal(v.go, false)
  assert.equal(v.stage, GATE.busy)
  assert.match(v.why, /도구 결과가 막 돌아왔다/)
  // 🔴 문구가 「사람」이라고 말하면 안 된다 — 사람은 아무 말도 하지 않았다
  assert.ok(!/사람/.test(v.why), `거짓 문구다: ${v.why}`)
})

test('🔴 도구 결과 뒤 5분이 지나면 이어받는다 (타임아웃분 60분을 기다리지 않는다)', () => {
  const v = gate({ activeMin: 6 })
  assert.equal(v.go, true, `${v.stage} · ${v.why}`)
})

test('경계 — 정확히 한계값이면 통과한다 (지나야 막는 쪽이 아니다)', () => {
  assert.equal(gate({ activeMin: 4.9 }).go, false)
  assert.equal(gate({ activeMin: 5 }).go, true)
})

test('🔴 사람이 물은 것은 그대로 타임아웃분까지 기다린다 (성질이 다르다)', () => {
  const v = gate({ activeMin: 30, lastKind: 'user' })
  assert.equal(v.go, false)
  assert.equal(v.stage, GATE.busy)
  assert.match(v.why, /마지막 차례가 사람이다/)
  // 낡음 탈출은 timeoutMin(60분) 이다 — 사람의 질문을 5분에 가로채지 않는다
  assert.equal(gate({ activeMin: 61, lastKind: 'user' }).go, true)
})

test('도구가 **아직 돌고 있으면**(미완결) 그것이 먼저 막는다', () => {
  const v = gate({ activeMin: 30, openTools: 2 })
  assert.equal(v.stage, GATE.busy)
  assert.match(v.why, /도구 2개가 결과를 기다리는 중/)
})

/**
 * 🔴 캐시 판을 올렸는지 확인한다.
 *   집계 캐시는 누적을 **그대로 이어서** 쓴다. `lastKind` 의 뜻이 바뀌었으므로 옛 캐시의
 *   값은 못 믿는다 — 판을 안 올리면 자라지 않는 세션이 영원히 옛 판정으로 남는다.
 */
test('🔴 집계 캐시 판을 올렸다 (lastKind 의 뜻이 바뀌었다)', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../src/lib/sessions.mjs', import.meta.url)), 'utf8')
  const m = /const ACC_VERSION = (\d+)/.exec(src)
  assert.ok(m, 'ACC_VERSION 을 못 찾았다')
  assert.ok(Number(m[1]) >= 4, `판이 ${m[1]} 이다 — 뜻을 바꿨으면 올려야 한다`)
})
