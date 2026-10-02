/**
 * ui-quit.test.mjs — 머리말의 «종료» 단추(quit.js). 사람이 누르는 길로 누른다.
 *
 * 🔴 사용자 요청 (2026-10-02): 화면에서 RetrySession 을 **완전히** 끈다 — stop.bat · 트레이 «종료» 와
 *   같은 scripts/stop-all.ps1. 지키는 것:
 *   - 확인 없이 끄지 않는다(감시가 멈추고 도는 재시작 회차도 끊긴다)
 *   - 두 번 눌러 두 번 보내지 않는다
 *   - 실패를 성공이라 하지 않는다
 *   - 끈 뒤에는 서버가 없는 것이 정상이다 — 폴링을 멈추고 «종료함» 을 말한다(사람이 멈췄다 ≠ 고장)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareRender } from './_ui-harness.mjs'
import { readUi } from './_ui-files.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const { cell, S } = prepareRender()
const { actions } = await import('../src/ui/common.js')
const { initQuit } = await import('../src/ui/quit.js')

let said = []
/** 시험마다 처음부터 — 칸을 비우고 다시 배선한다(순서에 묶이지 않게) */
function fresh() {
  prepareRender()
  S.stopped = null
  said = []
  actions.say = (t) => said.push(t)
  actions.draw = () => { }
  initQuit()
}
const btn = () => cell.get('btnQuit')
const press = () => btn()._on.click({ target: btn() })

test('🔴 확인을 거절하면 아무것도 보내지 않는다', async () => {
  fresh()
  const calls = []
  actions.post = async (...a) => { calls.push(a); return { ok: true } }
  globalThis.confirm = () => false
  await press()
  assert.equal(calls.length, 0)
  assert.equal(S.stopped, null)
})

test('🔴 확인 창이 무엇을 멈추는지와 다시 켜는 길(start.bat)을 말한다', async () => {
  fresh()
  let asked = ''
  globalThis.confirm = (m) => { asked = m; return false }
  await press()
  for (const w of ['트레이', '5분 감시', '재시작 회차', '예약 작업', 'start.bat']) assert.match(asked, new RegExp(w), w)
})

test('🔴 누르면 /api/shutdown 에 by:ui 를 보내고, 끈 뒤에는 «종료함» 을 말하고 다시 묻지 않는다', async () => {
  fresh()
  const calls = []
  actions.post = async (...a) => { calls.push(a); return { ok: true, at: '2026-10-02 18:00:00', note: '다시 켜려면 start.bat' } }
  globalThis.confirm = () => true
  await press()
  assert.deepEqual(calls.at(-1), ['/api/shutdown', { by: 'ui' }])
  assert.match(S.stopped, /18:00:00 종료함/)
  assert.match(S.stopped, /start\.bat/)
  assert.equal(btn().textContent, '종료함')
  assert.equal(btn().disabled, true)
  assert.match(said.at(-1), /종료했습니다/)
  await press()
  assert.equal(calls.length, 1, '이미 끈 뒤에 다시 보내면 안 된다')
})

test('🔴 두 번 눌러도 한 번만 보낸다', { timeout: 5000 }, async () => {
  fresh()
  globalThis.confirm = () => true
  const pending = []
  actions.post = () => new Promise((r) => pending.push(() => r({ ok: true, at: 'x' })))
  const first = press()
  assert.equal(btn().disabled, true, '보내는 동안 단추가 잠겨야 한다')
  const second = press()
  const sent = pending.length
  pending.forEach((release) => release())
  await Promise.all([first, second])
  assert.equal(sent, 1)
})

test('🔴 서버가 거절하거나 닿지 못하면 성공이라 하지 않고, 다시 누를 수 있다', async () => {
  fresh()
  globalThis.confirm = () => true
  actions.post = async () => ({ error: '다른 사이트에서 온 요청이다' })
  await press()
  assert.equal(S.stopped, null)
  assert.match(said.at(-1), /✖ 종료하지 못했습니다 — 다른 사이트/)
  assert.equal(btn().disabled, false)
  assert.equal(btn().textContent, '종료')
  actions.post = async () => null
  await press()
  assert.match(said.at(-1), /서버에 닿지 못했습니다/)
})

test('🔴 끈 뒤에는 폴링이 멈추고, 신선도 줄이 «읽기 실패» 가 아니라 «종료함» 을 말한다', () => {
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  for (const loop of ['loadStatus', 'checkBoot', 'loadDetail']) {
    const m = new RegExp(`pollLoop\\(${loop}, \\d+, ([^\\n]*)\\)`).exec(app)
    assert.ok(m, `${loop} 폴링을 찾지 못했다`)
    assert.match(m[1], /!S\.stopped/, `${loop} 가 종료 뒤에도 없는 서버에 묻는다 — 사람이 끈 것을 고장으로 읽는다`)
  }
  const fresh = app.slice(app.indexOf('function updateFreshness'))
  assert.ok(fresh.indexOf('S.stopped') < fresh.indexOf('S.error'), '종료를 읽기 실패보다 먼저 봐야 한다')
})

test('뼈대 — 단추는 머리말에 있고, 무엇을 끄는지 title 에 적는다', () => {
  const html = readUi('index.html')
  const header = /<header>([\s\S]*?)<\/header>/.exec(html)?.[1] || ''
  assert.match(header, /id="btnQuit"[^>]*title="[^"]*start\.bat/)
})
