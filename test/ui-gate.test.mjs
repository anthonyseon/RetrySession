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

/**
 * 방금 그린 배지들의 hover 문구.
 *
 * 🔴 목록의 배지는 **단어**다. 긴 근거는 hover(title)와 상세의 판정 패널에 있다.
 *   단어로 줄이면서 근거를 **버리지는 않았는지**를 여기서 확인한다 —
 *   짧게 만들다 정보를 잃으면, 읽기 쉬운 대신 판단할 수 없는 화면이 된다.
 */
const badgeTitles = () => cell.get('slist')
  .querySelectorAll('span').filter((x) => String(x.className).startsWith('badge'))
  .map((x) => x.getAttribute('title')).filter(Boolean)

const drawPanel = (s) => {
  S.state = { ...healthy(), sessions: [s] }
  S.openSession = ID
  S.detail = { ok: true, item: [], progress: { openTools: [], toolRunning: false }, activeMin: 60, bytes: 0, tailRead: 0, entryCount: 0, watchLog: [], restartLog: [], target: {} }
  S.tab = 'rs'
  redrawDetail()
  return cell.get('rsGate')
}

/* ── 목록 배지 ───────────────────────────────────────────────── */

/**
 * 🔴 배지는 **두 축을 함께** 말한다: 스위치(켬/꺼짐) · 지금 상태(돌 수 있나).
 *
 *   실측 (2026-09-22, 사용자 보고): [재시작 시작] 을 눌렀는데 "적용이 안 되는 것
 *   같다"고 했다. 등록부에는 **8초 전에 제대로 써졌는데** 배지가 `⊘ 재개 안 함 ·
 *   세션이 실행 중이다` 로 바뀌어서, 누른 것이 먹혔는지 알 수 없었다.
 *   `재시작 꺼짐` 과 `재개 안 함` 은 **다른 축의 말**인데 같은 자리에 번갈아 나왔다.
 *   그래서 켬/꺼짐을 항상 앞에 둔다 — 누르면 `꺼짐` → `켬` 이 눈에 보여야 한다.
 */
test('🔴 꺼짐/켬이 **항상** 보인다 (누른 것이 먹혔는지 알 수 있어야 한다)', () => {
  const off = session(undefined); off.restart.on = false
  assert.ok(drawList(off).includes('재시작 꺼짐'), '꺼진 것은 꺼졌다고')

  for (const gate of [
    { go: true, point: '재개지시', why: 'x' },
    { go: false, stage: 'running', why: '세션이 실행 중이다 (pid 7)' },
    { go: false, stage: 'blocked', why: '연속 3회 실패' },
    { go: false, stage: 'point', why: '추적기도 재개지시도 없다' },
    undefined,
  ]) {
    const txt = drawList(session(gate))
    assert.ok(txt.includes('재시작 켬'), `켜 놓은 것을 켰다고 말하지 않는다: ${JSON.stringify(gate)}\n${txt}`)
    assert.ok(!txt.includes('재시작 꺼짐'), '켠 것을 꺼졌다고 하면 안 된다')
  }
})

test('🔴 막혀 있으면 "준비"라고 하지 않고 **막는 이유**를 말한다', () => {
  const why = '세션이 실행 중이다 (pid 4084) — 사람이 쓰는 중이므로 건드리지 않는다'
  const txt = drawList(session({ go: false, stage: 'running', why }))
  assert.ok(txt.includes('대기'), '지금 돌지 않는다고 말해야 한다')
  assert.ok(txt.includes('실행중'), '무엇에 막혔는지 **단어**로 말해야 한다')
  assert.ok(!txt.includes('재시작 준비'), '🔴 예산만 보고 "준비"라고 말하던 그 버그다')
  /**
   * 🔴 단어로 줄였다고 **근거를 버리면 안 된다.** 목록에서는 단어로 훑고,
   *   긴 이유는 hover 와 상세의 판정 패널이 문장으로 말한다.
   *   (배지에 문장을 넣으면 한 줄이 배지 하나로 가득 차 옆 배지가 밀려난다.)
   */
  assert.ok(badgeTitles().some((t) => t === why),
    `막는 이유가 어디에도 남지 않았다 — 단어만 남기고 근거를 버렸다:\n${badgeTitles().join(' / ')}`)
})

test('통과하면 재개 지점을 말한다', () => {
  const txt = drawList(session({ go: true, stage: null, point: 'doing W3-2', why: '재개 지점 doing W3-2' }))
  assert.ok(txt.includes('가능'), txt)
  assert.ok(txt.includes('doing W3-2'), '무엇을 이어서 할 것인지 보여야 한다')
})

test('판정이 없으면(저장소를 못 찾음) 모른다고 말한다 — 준비라고 하지 않는다', () => {
  const txt = drawList(session(undefined))
  assert.ok(txt.includes('판정불가'), txt)
  assert.ok(!/· 가능/.test(txt), '모르는 것을 가능하다고 하면 안 된다')
  assert.ok(badgeTitles().some((t) => /찾지 못해/.test(t)), '왜 모르는지는 남아야 한다')
})

test('🔴 사람이 풀어야 하는 것(차단)과 기다리면 되는 것을 아이콘으로 가른다', () => {
  const blocked = drawList(session({ go: false, stage: 'blocked', why: '연속 3회 실패' }))
  assert.match(blocked, /▲/, '차단은 눈에 띄어야 한다')
  const waiting = drawList(session({ go: false, stage: 'active', why: '방금까지 활동이 있었다' }))
  assert.match(waiting, /◔/, '기다리면 되는 것은 경고가 아니다')
  assert.ok(!waiting.includes('▲'), '기다림에 경고 아이콘을 쓰면 진짜 경고가 묻힌다')
})

test('오늘 과부하로 막힌 횟수를 보여준다 (차단하지 않으므로 여기서라도 말해야 한다)', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.restart.overloadToday = 4
  const txt = drawList(s)
  assert.ok(txt.includes('과부하'), txt)
  assert.ok(txt.includes('4회'), '몇 번인지 말해야 한다')
})

/**
 * 🔴 로그인이 끊겨 헛돈 횟수도 보여준다. 과부하와 같은 이유(차단하지 않으니 말해야
 *   한다)인데, **한 번부터** 보여준다 — 529 한 번은 정상 범위지만 로그인은 그렇지 않다.
 */
test('로그인이 끊겨 헛돈 횟수를 한 번부터 보여준다', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.restart.authToday = 1
  const txt = drawList(s)
  assert.ok(txt.includes('로그인끊김'), txt)
  assert.ok(txt.includes('1회'), '몇 번인지 말해야 한다')
  assert.ok(badgeTitles().some((t) => /저절로 다시 돕니다|연속실패로 세지 않/.test(t)),
    '차단하지 않았다는 사실이 hover 에 남아야 한다 — 안 그러면 사람이 차단을 풀러 간다')
})

test('끊긴 적이 없으면 그 배지는 없다 (0 을 보여주면 없는 문제를 만든다)', () => {
  const txt = drawList(session({ go: true, point: '재개지시', why: 'x' }))
  assert.ok(!txt.includes('로그인끊김'), txt)
})

test('응답이 끊긴 자리를 보여준다 (사람이 "왜 여기서 멈췄지"를 묻는 상태다)', () => {
  const txt = drawList(session({ go: true, point: '끊긴 지점', why: 'x' },
    { stoppedByInterrupt: true, interruptNoticeTime: '2026-09-22 10:00:00' }))
  assert.ok(txt.includes('응답 끊김'), txt)
  // 시각은 배지가 아니라 hover 와 상세가 말한다 — 목록의 한 줄을 시각으로 채우지 않는다
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
