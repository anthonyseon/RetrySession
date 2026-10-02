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
  activeMin: 60, userMsgs: 9, assistantMsgs: 11, toolCalls: 7, tokenSum: 5_000_000, costUSD: 12.5,
  // 오늘 몫은 누적보다 **작게** 둔다 — 두 줄이 정말 갈렸는지 시험이 보려면 달라야 한다
  todayKey: '2026-09-28', todayUserMsgs: 2, todayAssistantMsgs: 3, todayToolCalls: 1,
  todayTokenSum: 250_000, todayCostUSD: 1.25,
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

/** 사용량 줄 앞의 `오늘`·`누적` 표에 달린 hover 문구 (배지가 아니라 b.utag 다) */
const tagTitles = () => cell.get('slist')
  .querySelectorAll('b').filter((x) => String(x.className).includes('utag'))
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
  const why = '도구 2개가 결과를 기다리는 중이다 — 일하는 세션에 끼어들지 않는다'
  const txt = drawList(session({ go: false, stage: 'busy', why }))
  assert.ok(txt.includes('대기'), '지금 돌지 않는다고 말해야 한다')
  assert.ok(txt.includes('작업중'), '무엇에 막혔는지 **단어**로 말해야 한다')
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
 * 🔴 타임아웃도 같은 대접 — 실패로 세지 않는 대신 **보여준다**(실측 2026-09-28: 세 회차가
 *   일하는 중에 잘렸고, 그 기록은 $0 이었다). 색은 두 번부터 준다(하루 2회면 경보).
 */
test('오늘 타임아웃으로 잘린 횟수를 보여준다 (실패로 세지 않으므로)', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.restart.timeoutToday = 2
  const txt = drawList(s)
  assert.ok(txt.includes('시간초과'), txt)
  assert.ok(txt.includes('2회'), '몇 번인지 말해야 한다')
})

test('잘린 적이 없으면 그 배지는 없다 (0회를 보여주면 눈이 지친다)', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.restart.timeoutToday = 0
  assert.ok(!drawList(s).includes('시간초과'))
})

/* ── 사용량: 오늘과 누적 ─────────────────────────────────────── */

/**
 * 🔴 사용량은 **오늘(로컬)과 누적을 갈라** 두 줄로 그린다.
 *   누적만 보면 "지금 얼마나 쓰고 있나"를 알 수 없고, 오늘만 보면 이 세션이 얼마짜리인지
 *   알 수 없다. 어느 쪽이 무엇인지도 화면이 말해야 한다 — 숫자 두 개를 슬래시로 붙이면
 *   사람이 순서를 기억해야 읽힌다.
 */
test('🔴 사용량을 오늘·누적 두 줄로 그린다 (네 항목 모두)', () => {
  const txt = drawList(session({ go: true, point: '재개지시', why: 'x' }))
  assert.ok(txt.includes('오늘'), `오늘 줄이 없다: ${txt}`)
  assert.ok(txt.includes('누적'), '누적 줄이 없다')
  // 오늘: 턴 u2/a3 · 도구 1 · 토큰 250.0K · $1.25
  assert.match(txt, /오늘.*u2\/a3.*1.*250\.0K.*\$1\.25/, `오늘 줄의 값이 틀렸다: ${txt}`)
  // 누적: 턴 u9/a11 · 도구 7 · 토큰 5.0M · $12.50
  assert.match(txt, /누적.*u9\/a11.*7.*5\.0M.*\$12\.50/, `누적 줄의 값이 틀렸다: ${txt}`)
  assert.ok(txt.indexOf('오늘') < txt.indexOf('누적'), '오늘이 위에 온다 — 자주 보는 쪽이 먼저다')
})

test('🔴 오늘 줄이 어느 날짜인지 hover 로 남는다 (자정에 0 이 되는 이유)', () => {
  drawList(session({ go: true, point: '재개지시', why: 'x' }))
  assert.ok(badgeTitles().concat(tagTitles()).some((t) => /2026-09-28/.test(t)),
    '오늘이 어느 날짜인지 볼 곳이 있어야 한다 — 자정을 넘긴 화면이 어제를 오늘이라 말하면 안 된다')
})

test('오늘 몫이 0 이어도 줄은 그린다 (줄이 사라지면 비교할 것이 없다)', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.todayUserMsgs = 0; s.todayAssistantMsgs = 0; s.todayToolCalls = 0
  s.todayTokenSum = 0; s.todayCostUSD = 0
  const txt = drawList(s)
  assert.match(txt, /오늘.*u0\/a0.*\$0\.00/, `오늘 0 을 그려야 한다: ${txt}`)
  assert.ok(txt.includes('누적'), '누적은 그대로 있어야 한다')
})

/**
 * 🔴 상세의 **처리 상황** 탭도 오늘·누적을 갈라 보여준다. 목록은 훑는 자리이고
 *   여기는 들여다보는 자리다 — 모델별로 **오늘 무엇을 태우고 있나**까지 나와야 한다.
 */
test('🔴 상세가 오늘·누적을 갈라 보여주고 모델별 표를 둘 그린다', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.byModel = { 'claude-opus-5': { input: 100, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 50, usd: 12.5 } }
  s.todayByModel = { 'claude-opus-5': { input: 10, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 5, usd: 1.25 } }
  S.state = { ...healthy(), sessions: [s] }
  S.openSession = ID
  S.tab = 'now'
  S.detail = { ok: true, item: [], progress: { openTools: [], toolRunning: false }, activeMin: 60, bytes: 0, tailRead: 0, entryCount: 0, watchLog: [], restartLog: [], target: {} }
  redrawDetail()
  const txt = cell.get('tab-now').textContent
  assert.match(txt, /오늘/, `오늘 줄이 없다: ${txt}`)
  assert.match(txt, /누적/, '누적 줄이 없다')
  assert.match(txt, /\$1\.25/, '오늘 정가가 없다')
  assert.match(txt, /\$12\.50/, '누적 정가가 없다')
  assert.match(txt, /모델별 — 오늘/, '오늘 모델표가 없다 — 무엇을 태우고 있나를 볼 곳이 없다')
  assert.match(txt, /모델별 — 누적/, '누적 모델표가 없다')
})

test('오늘 쓴 모델이 없으면 오늘 표는 그리지 않는다 (빈 표는 읽을 것이 없다)', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.byModel = { 'claude-opus-5': { input: 100, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 50, usd: 12.5 } }
  s.todayByModel = {}
  S.state = { ...healthy(), sessions: [s] }
  S.openSession = ID; S.tab = 'now'
  S.detail = { ok: true, item: [], progress: { openTools: [], toolRunning: false }, activeMin: 60, bytes: 0, tailRead: 0, entryCount: 0, watchLog: [], restartLog: [], target: {} }
  redrawDetail()
  const txt = cell.get('tab-now').textContent
  assert.ok(!txt.includes('모델별 — 오늘'), '오늘 쓴 것이 없으면 그 표는 없다')
  assert.match(txt, /모델별 — 누적/, '누적 표는 남아야 한다')
  assert.match(txt, /오늘/, '요약 줄의 오늘은 0 으로라도 남아야 한다')
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

test('일하는 중이면 무엇을 기다리는지 말한다 (단추로 풀 수 있는 일이 아니다)', () => {
  const box = drawPanel(session({ go: false, stage: 'busy', why: '도구 1개가 결과를 기다리는 중이다' }))
  assert.match(box.textContent, /일하는 중|끝나고 조용해지면/, '왜 기다리는지 알려줘야 한다')
  // 🔴 창이 열려 있는 것 자체는 더 이상 막는 이유가 아니다 — 그 문구가 남아 있으면 거짓이다
  assert.ok(!/창을 닫으면 다음 회차부터 대상이 됩니다$/.test(box.textContent), '창을 닫으라고 하면 안 된다')
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

/* ── 추적기 배지 ─────────────────────────────────────────────── */

/**
 * 🔴 툴팁이 없었다(사용자 지적 2026-09-29). 다른 배지는 전부 `why` 를 넘기는데 이것만
 *   빠져 있어서 **`9/9` 의 숫자가 무엇인지 화면에 설명이 없었다.** 배지는 단어로 짧게,
 *   뜻은 툴팁으로 — 그 규칙에서 이 배지만 빠져 있던 것이다.
 */
test('🔴 추적기 배지에 툴팁이 있고, 숫자의 뜻을 설명한다', () => {
  const s = session({ go: true, point: 'doing 07', why: 'x' })
  s.tracker = { exists: true, doneMark: '3/9', allDone: false, doing: { id: '07', title: '코드 인용 판정' } }
  drawList(s)
  const b = [...badgeTitles(), cell.get('slist').textContent].join(' | ')
  assert.match(b, /추적기 3\/9/, '배지 글자는 짧게')
  assert.match(b, /끝난 단계 \/ 전체 단계/, '숫자의 뜻을 말해야 한다')
  assert.match(b, /재시작이 "무엇을 이어서 할지" 여기서 고릅니다/, '역할을 말해야 한다')
  assert.match(b, /doing 07/, '지금 재개 지점을 말해야 한다')
})

test('전부 done 이면 «이어서 할 것이 없다» 와 다음 수단을 말한다', () => {
  const s = session({ go: false, stage: 'tracker', why: '할 일이 없다' })
  s.tracker = { exists: true, doneMark: '9/9', allDone: true }
  drawList(s)
  const b = [...badgeTitles(), cell.get('slist').textContent].join(' | ')
  assert.match(b, /전부 done/)
  assert.match(b, /재개지시를 넣으면 그것이 이깁니다/, '막다른 길로 두지 않는다')
})

/**
 * 🔴 사용자 질문 (2026-09-29): 「추적기는 갱신이 안되는가?」
 *   읽기는 늘 최신인데 **파일이 며칠째 그대로**일 수 있고, 그때 `9/9` 만 보이면 진행 중인
 *   장부로 읽힌다. 그리고 재개지시로 도는 세션은 지시문에 추적기 규약이 들어가지 않아
 *   무인 회차가 그 장부를 고치지 않는다 — 둘 다 화면이 말해야 한다.
 */
test('🔴 추적기가 며칠째 그대로면 배지와 툴팁이 그렇게 말한다', () => {
  const s = session({ go: true, point: 'doing 07', why: 'x' })
  s.tracker = {
    exists: true, doneMark: '9/9', allDone: true,
    fileAt: '2026-09-22 08:17:56', fileAgeMin: 7 * 1440 + 30,
  }
  drawList(s)
  const b = [...badgeTitles(), cell.get('slist').textContent].join(' | ')
  assert.match(b, /7일 그대로/, '며칠째 그대로인지 배지에 보여야 한다')
  assert.match(b, /마지막 수정: 2026-09-22 08:17:56/, '언제 바뀐 파일인지 말해야 한다')
  assert.match(b, /읽기만 합니다 — 갱신은 재개된 세션이 합니다/, '누가 고치는지 말해야 한다')
})

test('🔴 재개지시로 도는 세션에는 «추적기가 갱신되지 않는다» 고 적는다', () => {
  const s = session({ go: true, point: '재개지시', why: 'x' })
  s.tracker = { exists: true, doneMark: '9/9', allDone: true, fileAt: '2026-09-22 08:17:56', fileAgeMin: 9999 }
  drawList(s)
  const b = badgeTitles().join(' | ')
  assert.match(b, /재개지시.*로 돕니다/, '지금 무엇으로 도는지 말해야 한다')
  assert.match(b, /이 장부를 고치지 않습니다/, '왜 안 바뀌는지가 답이다')
  assert.match(b, /재개지시를 비우세요/, '추적기로 돌리는 방법도 말해야 한다')
})

test('방금 갱신된 추적기에는 «그대로» 를 적지 않는다 (없는 문제를 만들지 않는다)', () => {
  const s = session({ go: true, point: 'doing 03', why: 'x' })
  s.tracker = { exists: true, doneMark: '3/9', allDone: false, doing: { id: '03' }, fileAt: '지금', fileAgeMin: 4 }
  drawList(s)
  assert.ok(!/그대로/.test(cell.get('slist').textContent), '배지 글자에 군더더기를 넣지 않는다')
})
