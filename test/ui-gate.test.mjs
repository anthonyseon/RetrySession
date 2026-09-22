/**
 * ui-gate.test.mjs — 화면이 **재개 판정을 그대로** 말하는가.
 *
 * 🔴 실측 결함 (2026-09-22)
 *   목록의 재시작 배지는 **예산만** 보고 "재시작 준비"라고 말했다. 실제로는 여덟
 *   가지가 더 막는다(실행 중·재개 지점 없음·저장소 잠금·조용한 시간·제한·활동·차단·
 *   추적기 전부 done). 그래서 사람은 "준비"를 믿고 자리를 비웠는데 15분마다 조용히
 *   건너뛰었고, "켰는데 왜 안 도나"를 반복해서 물었다.
 *
 *   **없는 것을 있다고 말하는 것은 있는 것을 없다고 하는 것만큼 나쁘다.**
 *   판정은 lib/resume-gate.mjs 하나이고, 화면은 그것을 옮기기만 해야 한다.
 *
 * 🔴 이유만 말하고 끝내지 않는다 — 고칠 수 있는 것에는 **단추**를 함께 준다.
 *   어디서 고치는지 말하지 않으면 사람은 또 찾아다닌다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareRender, healthy } from './_ui-harness.mjs'

const { cell, S } = prepareRender()
globalThis.confirm = () => true
globalThis.alert = () => { }

const { items } = await import('../src/ui/list.js')
const { redrawDetail } = await import('../src/ui/detail.js')
const { actions } = await import('../src/ui/common.js')

const ID = 'aaaaaaaa-1111-2222-3333-444444444444'

/** 재시작을 켠 세션 하나 — gate 만 갈아끼워 상황을 만든다 */
const session = (gate, over = {}) => ({
  sessionId: ID, shortId: 'aaaaaaaa', title: '제목', runKnown: true, running: false,
  activeMin: 60, userMsgs: 1, assistantMsgs: 1, toolCalls: 0, tokenSum: 0, costUSD: 0,
  mainCwd: 'c:\\x', runCwd: 'c:\\x', registered: true,
  watch: { on: false, verdict: null }, tracker: { exists: false },
  restart: {
    on: true, runsToday: 2, maxPerDay: 12, costToday: 0.4, maxCostUSDPerDay: 5,
    failStreak: 0, failStreakMax: 3, overloadToday: 0, permissionMode: 'acceptEdits', gate,
  },
  ...over,
})

const drawList = (s) => {
  S.state = { ...healthy(), sessions: [s] }
  S.picked = new Set()
  items(S.state)
  return cell.get('slist').textContent
}

const drawPanel = (s) => {
  S.state = { ...healthy(), sessions: [s] }
  S.openSession = ID
  S.detail = { ok: true, item: [], progress: { openTools: [], toolRunning: false }, activeMin: 60, bytes: 0, tailRead: 0, entryCount: 0, watchLog: [], restartLog: [], target: {} }
  S.tab = 'rs'
  redrawDetail()
  return cell.get('rsGate')
}

/* ── 목록 배지 ───────────────────────────────────────────────── */

test('🔴 막혀 있으면 "준비"라고 하지 않고 **막는 이유**를 말한다', () => {
  const why = '세션이 실행 중이다 (pid 4084) — 사람이 쓰는 중이므로 건드리지 않는다'
  const txt = drawList(session({ go: false, stage: 'running', why }))
  assert.ok(txt.includes('재개 안 함'), '막혀 있다고 말해야 한다')
  assert.ok(txt.includes(why), `막는 이유가 그대로 나와야 한다:\n${txt}`)
  assert.ok(!txt.includes('재시작 준비'), '🔴 예산만 보고 "준비"라고 말하던 그 버그다')
})

test('통과하면 재개 지점을 말한다', () => {
  const txt = drawList(session({ go: true, stage: null, point: 'doing W3-2', why: '재개 지점 doing W3-2' }))
  assert.ok(txt.includes('재개 가능'), txt)
  assert.ok(txt.includes('doing W3-2'), '무엇을 이어서 할 것인지 보여야 한다')
})

test('판정이 없으면(저장소를 못 찾음) 모른다고 말한다 — 준비라고 하지 않는다', () => {
  const txt = drawList(session(undefined))
  assert.ok(txt.includes('판정할 수 없다'), txt)
  assert.ok(!txt.includes('재개 가능'), '모르는 것을 가능하다고 하면 안 된다')
})

test('🔴 사람이 풀어야 하는 것(차단)과 기다리면 되는 것을 색으로 가른다', () => {
  const blocked = drawList(session({ go: false, stage: 'blocked', why: '연속 3회 실패' }))
  assert.match(blocked, /▲/, '차단은 눈에 띄어야 한다')
  const waiting = drawList(session({ go: false, stage: 'active', why: '방금까지 활동이 있었다' }))
  assert.match(waiting, /⊘/, '기다리면 되는 것은 경고가 아니다')
})

test('오늘 과부하로 막힌 횟수를 보여준다 (차단하지 않으므로 여기서라도 말해야 한다)', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.restart.overloadToday = 4
  const txt = drawList(s)
  assert.ok(txt.includes('API 과부하로 막힘'), txt)
  assert.ok(txt.includes('4회'), '몇 번인지 말해야 한다')
})

test('응답이 끊긴 자리를 보여준다 (사람이 "왜 여기서 멈췄지"를 묻는 상태다)', () => {
  const txt = drawList(session({ go: true, point: '끊긴 지점', why: 'x' },
    { stoppedByInterrupt: true, interruptNoticeTime: '2026-09-22 10:00:00' }))
  assert.ok(txt.includes('응답이 끊김'), txt)
  assert.ok(txt.includes('2026-09-22 10:00:00'), '언제 끊겼는지 보여야 한다')
})

/* ── 상세의 판정 패널 ────────────────────────────────────────── */

test('🔴 판정과 숫자가 로그보다 **위에** 있다', () => {
  const box = drawPanel(session({ go: false, stage: 'active', why: '방금까지 활동이 있었다 (2분 전, 한계 10분)' }))
  const t = box.textContent
  assert.ok(t.includes('재개 안 함'), t)
  assert.ok(t.includes('방금까지 활동이 있었다'), t)
  assert.ok(t.includes('오늘 2/12회'), '상한에 얼마나 가까운지 보여야 한다')
  assert.ok(t.includes('연속실패 0/3'), t)
})

test('🔴 재개 지점이 없으면 [재개지시 넣기] 단추를 준다 — 이유만 말하고 끝내지 않는다', () => {
  const box = drawPanel(session({ go: false, stage: 'point', why: '추적기도 재개지시도 없다' }))
  const b = box.querySelectorAll('button').find((x) => x.textContent === '재개지시 넣기')
  assert.ok(b, `단추가 없다:\n${box.textContent}`)
  S.tab = 'rs'
  b.fire('click')
  assert.equal(S.tab, 'cfg', '누르면 재개지시를 넣는 탭으로 데려가야 한다')
})

test('🔴 차단됐으면 [차단 해제] 단추가 실제로 요청을 보낸다', async () => {
  const sent = []
  const real = actions.post
  actions.post = async (url, body) => { sent.push({ url, body }); return { ok: true } }
  actions.loadDetail = () => { }
  try {
    const box = drawPanel(session({ go: false, stage: 'blocked', why: '연속 3회 실패' }))
    const b = box.querySelectorAll('button').find((x) => x.textContent === '차단 해제')
    assert.ok(b, `단추가 없다:\n${box.textContent}`)
    await b._on.click({ target: b })
    assert.deepEqual(sent, [{ url: '/api/rearm', body: { sessionIds: [ID] } }])
  } finally { actions.post = real }
})

test('실행 중이면 무엇을 하면 되는지 말한다 (단추로 풀 수 있는 일이 아니다)', () => {
  const box = drawPanel(session({ go: false, stage: 'running', why: '세션이 실행 중이다 (pid 7)' }))
  assert.match(box.textContent, /창을 닫으면/, '사람이 할 수 있는 일을 알려줘야 한다')
  assert.equal(box.querySelectorAll('button').length, 0, '누를 수 없는 단추를 주면 안 된다')
})

test('저장소 잠금이면 어느 파일을 고치는지 말한다', () => {
  const box = drawPanel(session({ go: false, stage: 'repo', why: '이 저장소는 자율 재개가 꺼져 있다' }))
  assert.match(box.textContent, /config\/projects\.json/, '어디를 고치는지 말해야 한다')
  assert.match(box.textContent, /resume\.enabled/)
})

test('재시작이 꺼져 있으면 켜는 법을 말한다', () => {
  const s = session(undefined); s.restart.on = false
  const box = drawPanel(s)
  assert.match(box.textContent, /재시작 시작/, '어디를 누르면 되는지 말해야 한다')
})
