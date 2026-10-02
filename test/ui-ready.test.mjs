/**
 * ui-ready.test.mjs — «자동 이어받기 조건» 안의 **이 PC 에서 돌 수 있나** 패널과 «이 PC 준비하기» 단추.
 *
 * 그려 보고, 사람이 누르는 길로 누른다. 판정은 서버의 것(lib/ready.mjs)을 그대로 써서 만든다 —
 * 화면 시험이 제 나름의 표본을 만들면 서버와 다른 모양을 그리고도 통과한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareRender } from './_ui-harness.mjs'
import { readUi } from './_ui-files.mjs'
import { readyVerdict } from '../src/lib/ready.mjs'

const { cell, S } = prepareRender()
const { actions } = await import('../src/ui/common.js')
const { drawReady, initReady } = await import('../src/ui/ready.js')

const task = (over = {}) => ({ registered: true, healthy: true, isRunning: false, stopped: false, resultText: '성공', ...over })
const input = () => ({
  node: { version: 'v24.21.0', dir: 'C:\\n', onPath: true },
  exe: { runhidden: true, start: true, csc: true },
  tasks: { heartbeat: task(), UI: task(), tray: task(), restart: task() },
  pc: { read: true, level: 'ok', fixable: [], items: [] },
  account: { loggedIn: true, email: 'a@b.c', error: null },
  cli: { installed: true },
  config: { count: 1, missing: [], error: null },
})
const okState = () => ({ ready: readyVerdict(input()) })
const brokenState = () => {
  const x = input()
  x.tasks.heartbeat = task({ registered: false })
  x.pc = { read: true, level: 'crit', fixable: ['standbyAc'], items: [{ key: 'standbyAc', name: '절전 (전원 연결)', level: 'crit', current: '5분 뒤', why: '5분 뒤 잠든다' }] }
  x.config = { count: 1, missing: [{ id: 'Description', repo: 'C:/x' }], error: null }
  return { ready: readyVerdict(x) }
}

/** 시험마다 처음부터 — 칸을 비우고 다시 배선한다(순서에 묶이지 않게) */
function fresh(state) {
  prepareRender()
  S.state = state
  initReady()
  drawReady(state)
}
const btn = () => cell.get('btnReady')
const press = () => btn()._on.click({ target: btn() })
const txt = (id) => cell.get(id).textContent

test('다 갖추면 접힌 줄에 «PC 준비됨» 이고, 단추는 고칠 것이 없어 잠긴다', () => {
  fresh(okState())
  assert.match(txt('readyDigest'), /PC 준비됨/)
  assert.equal(btn().disabled, true)
  assert.match(btn().title, /고칠 것이 없다/)
  assert.equal(cell.get('readyList').children.length, okState().ready.items.length)
})

test('🔴 안 되는 PC 는 접힌 줄에도 «안 됨» 과 개수가 남는다 (접어 둔 채로 숨으면 안 된다)', () => {
  fresh(brokenState())
  assert.match(txt('readyDigest'), /PC 준비 안 됨 · 2/)
  const badge = cell.get('readyDigest').children[0]
  assert.match(badge.title, /절전/, '무엇이 걸렸는지 hover 에 있어야 한다')
})

test('🔴 판정을 못 받았으면 «모름» 이다 — 준비됐다고 말하지 않는다', () => {
  fresh({})
  assert.match(txt('readyDigest'), /PC 준비 모름/)
  assert.match(txt('readyList'), /준비됐다고 말하지 않는다/)
  assert.equal(btn().disabled, true)
})

test('안 되는 줄은 이유와 방법을 **보이게** 적고, 누가 고치는지 단어로 말한다', () => {
  fresh(brokenState())
  const list = txt('readyList')
  assert.match(list, /5분 뒤 잠든다/, '이유가 hover 에만 있으면 안 된다')
  assert.match(list, /projects\.local\.json/, '직접 고칠 것은 방법을 적어야 한다')
  assert.match(list, /단추가 고침/)
  assert.match(list, /직접/)
  assert.equal(btn().disabled, false)
  assert.match(btn().textContent, /이 PC 준비하기 \(2\)/)
})

test('🔴 누르면 무엇을 바꾸는지 확인받고, /api/ready 에 apply 를 보내고, 결과를 말한다', async () => {
  fresh(brokenState())
  let question = ''
  globalThis.confirm = (q) => { question = q; return true }
  const calls = []
  actions.post = async (path, body) => { calls.push([path, body]); return { ok: true, results: [{ key: 'heartbeat', name: '감시 예약 등록', ok: true }, { key: 'power', name: '전원 설정', ok: true }] } }
  await press()
  assert.match(question, /예약: 감시/)
  assert.match(question, /전원/)
  assert.match(question, /되돌릴 수 있습니다/, '되돌릴 길을 모르면 사람은 누르지 못한다')
  assert.match(question, /재시작 작업 등록/, '하지 않는 것도 말해야 한다')
  assert.deepEqual(calls.at(-1), ['/api/ready', { action: 'apply' }])
  assert.match(txt('readyMsg'), /✅ 2단계 적용/)
})

test('확인을 거절하면 아무것도 보내지 않는다', async () => {
  fresh(brokenState())
  globalThis.confirm = () => false
  const calls = []
  actions.post = async (...a) => { calls.push(a); return {} }
  await press()
  assert.equal(calls.length, 0)
})

test('🔴 실패한 단계는 이름과 마지막 줄을, 건너뛴 단계는 «건너뜀» 을 적는다', async () => {
  fresh(brokenState())
  globalThis.confirm = () => true
  actions.post = async () => ({ ok: false, results: [
    { key: 'exe', name: '실행 파일 만들기', ok: false, output: 'compiler : x\ncsc.exe 를 찾지 못했다' },
    { key: 'heartbeat', name: '감시 예약 등록', ok: false, skipped: true, output: '실행 파일을 못 만들어 건너뛰었다' },
    { key: 'power', name: '전원 설정', ok: true },
  ] })
  await press()
  const m = txt('readyMsg')
  assert.match(m, /3단계 중 2단계 실패/)
  assert.match(m, /실행 파일 만들기: csc\.exe 를 찾지 못했다/)
  assert.match(m, /감시 예약 등록 \(건너뜀\)/)
})

test('보내지 못했거나 서버가 거절하면 그렇게 말한다 (반응 없는 화면은 고장난 화면이다)', async () => {
  fresh(brokenState())
  globalThis.confirm = () => true
  actions.post = async () => null
  await press()
  assert.match(txt('readyMsg'), /보내지 못했습니다/)
  actions.post = async () => ({ error: '이미 적용하는 중이다' })
  await press()
  assert.match(txt('readyMsg'), /적용하지 못했습니다 — 이미 적용하는 중이다/)
})

/**
 * 🔴 두 번째 누름을 **기다리지 않는다.** 막는 장치가 빠지면 두 번째도 끝나지 않는 응답을 기다려
 *   시험이 실패하지 않고 **멈췄다**(실측 — 결함을 되살려 봤을 때). 보내는 것은 누르는 순간
 *   동기로 일어나므로 개수는 바로 센다. 붙잡은 응답은 전부 풀고, 제한 시간도 둔다.
 */
test('🔴 적용하는 동안 다시 눌러도 겹쳐 보내지 않는다', { timeout: 5000 }, async () => {
  fresh(brokenState())
  globalThis.confirm = () => true
  const pending = []
  actions.post = () => new Promise((r) => pending.push(() => r({ ok: true, results: [] })))
  const first = press()
  assert.equal(btn().disabled, true, '도는 동안 단추가 잠겨야 한다')
  assert.match(btn().textContent, /적용하는 중/)
  const second = press()
  const sent = pending.length
  pending.forEach((release) => release())
  await Promise.all([first, second])
  assert.equal(sent, 1, '두 번 눌러 두 번 보냈다 — 서버가 409 로 막더라도 화면이 먼저 막아야 한다')
})

/* ── 다시 확인 ───────────────────────────────────────────────── */

const check = () => cell.get('btnReadyCheck')._on.click({ target: cell.get('btnReadyCheck') })
/** post 는 끝난 뒤 상태를 다시 읽는다(app.js) — 그것을 흉내낸다: 서버가 새로 읽은 판정이 S.state 로 들어온다 */
const postThen = (next, reply = { ok: true, at: '2026-10-02 09:00:00' }, calls = []) => async (path, body) => {
  calls.push([path, body]); S.state = next; return reply
}

test('다시 확인 단추는 고칠 것이 없어도 눌린다 (확인은 고치는 것이 아니다)', () => {
  fresh(okState())
  assert.equal(cell.get('btnReadyCheck').disabled, false)
  assert.equal(cell.get('btnReadyCheck').textContent, '다시 확인')
})

test('🔴 다시 확인은 /api/ready 에 check 를 보내고, 이어 읽은 판정과 비교해 **바뀐 것**을 말한다', async () => {
  fresh(brokenState())
  const calls = []
  actions.post = postThen(okState(), undefined, calls)
  await check()
  assert.deepEqual(calls.at(-1), ['/api/ready', { action: 'check' }])
  const m = txt('readyMsg')
  assert.match(m, /09:00:00 다시 확인했습니다/)
  assert.match(m, /바뀐 것 3개/)
  assert.match(m, /예약: 감시 \(5분\): 안 됨 → 됨/)
  assert.match(m, /전원 \(잠들지 않기\): 안 됨 → 됨/)
})

test('바뀐 것이 없으면 그렇게 말한다 — 눌렀는데 표가 그대로면 먹었는지 모른다', async () => {
  fresh(okState())
  actions.post = postThen(okState())
  await check()
  assert.match(txt('readyMsg'), /바뀐 것 없음/)
})

test('다시 확인을 못 보냈거나 서버가 거절하면 그렇게 말한다', async () => {
  fresh(okState())
  actions.post = async () => null
  await check()
  assert.match(txt('readyMsg'), /보내지 못했습니다/)
  actions.post = async () => ({ error: 'action 은 …' })
  await check()
  assert.match(txt('readyMsg'), /다시 확인하지 못했습니다/)
})

test('🔴 확인하는 동안에는 적용도 다시 확인도 겹쳐 보내지 않는다', { timeout: 5000 }, async () => {
  fresh(brokenState())
  globalThis.confirm = () => true
  const pending = []
  actions.post = () => new Promise((r) => pending.push(() => r({ ok: true, at: 'x' })))
  const first = check()
  assert.equal(cell.get('btnReadyCheck').disabled, true)
  assert.match(cell.get('btnReadyCheck').textContent, /확인하는 중/)
  assert.equal(btn().disabled, true, '확인 도중 등록이 끼면 «바뀐 것» 이 섞인다')
  const others = [check(), press()]
  const sent = pending.length
  pending.forEach((release) => release())
  await Promise.all([first, ...others])
  assert.equal(sent, 1)
})

test('🔴 판정에 쓴 값의 나이를 말하고, 모르면 «모름» 이다', () => {
  const x = input()
  x.tasks.ageMs = 12000
  fresh({ ready: readyVerdict(x) })
  assert.match(txt('readyAt'), /예약 12초 전/)
  assert.match(txt('readyAt'), /전원 모름/, '나이를 모르는 값을 «방금» 이라고 하면 안 된다')
  assert.match(txt('readyAt'), /30초/, '저절로 다시 읽는 주기도 적는다 — 그래야 단추를 누를 이유가 보인다')
})

test('뼈대 — 점검표는 «자동 이어받기 조건» 안 맨 앞에, 요지는 접힌 줄에 있다', () => {
  const html = readUi('index.html')
  const box = /<details class="howto" id="howto">([\s\S]*?)<\/details>/.exec(html)
  assert.ok(box, '자동 이어받기 조건을 찾지 못했다')
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(box[1])[1]
  assert.match(summary, /id="readyDigest"/, '접힌 줄에 요지가 있어야 한다')
  for (const id of ['readyList', 'btnReady', 'readyMsg']) assert.match(box[1], new RegExp(`id="${id}"`), id)
  assert.match(html, /id="readyMsg"[^>]*role="status"/, '결과는 화면 낭독기에도 전해야 한다')
  // 🔴 단추가 조건 표 **앞**이어야 펼치자마자 보인다(표 아래에 두었더니 넓은 화면에서 잘렸다)
  const body = box[1].indexOf('id="howBody"'), btnAt = box[1].indexOf('id="btnReady"'), tableAt = box[1].indexOf('<table>')
  assert.ok(body > 0 && body < btnAt && btnAt < tableAt, '점검표가 구르는 상자 안, 조건 표 앞에 있어야 한다')
})

/**
 * 🔴 실측 결함 (2026-10-02): 시험은 다 통과했는데, 실제 브라우저(1500×980)에서 펼치니 점검표가
 *   높이를 넘겨 «이 PC 준비하기» 단추가 화면 밖으로 잘렸다 — 그때는 페이지가 구르지 않았다.
 *   지금은 페이지도 구르지만(2026-10-02) 상한은 남긴다 — 펼치자마자 단추가 보여야 한다.
 *   하네스에는 레이아웃이 없어 이것을 그려서는 못 잡는다. 규칙이 있는지로 지킨다.
 */
test('🔴 펼친 내용은 한 상자에서 구르고(넓은 화면), 좁은 화면에서는 페이지에 맡긴다', () => {
  const css = readUi('ready.css')
  assert.match(css, /#howBody\{[^}]*max-height:\s*\d+vh/, '높이 한계가 없으면 단추가 화면 밖으로 잘린다')
  assert.match(css, /#howBody\{[^}]*overflow-y:\s*auto/)
  const narrow = /@media \(max-width:1100px\)\{([\s\S]*?)\n\}/.exec(css)
  assert.ok(narrow, '좁은 화면 규칙이 있어야 한다')
  assert.match(narrow[1], /#howBody\{max-height:none/, '페이지가 구르는 곳에서 또 가두면 스크롤 안의 스크롤이다')
})
