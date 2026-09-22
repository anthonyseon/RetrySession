/**
 * ui-fold.test.mjs — **접고 펴는 것**이 정말 접히고 펴지나.
 *
 * 🔴 왜 이제야 시험할 수 있게 됐나
 *   하네스의 `classList` 가 아무것도 하지 않는 껍데기였고 `localStorage` 는 늘 null 을
 *   돌려줬다. 접힘은 **클래스로만** 표현되고 **기억되는 것이 요점**이라, 그 둘이
 *   껍데기인 동안은 눌러 봐도 통과만 했다. 하네스를 진짜로 만들고 나서 넣는 시험이다.
 *
 * 🔴 접기는 정보를 **지우는 것이 아니다.** 접어도 요지는 남아야 한다 —
 *   접힌 것이 "없는 것"으로 보이면 감시 장치가 스스로 눈을 가리는 셈이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareRender, healthy } from './_ui-harness.mjs'

const { cell, S, drawTiles } = prepareRender()
const { drawFolders } = await import('../src/ui/list.js')

/**
 * 🔴 접힘은 **기억되는 것이 요점**이라 시험 사이에도 남는다.
 *   비우지 않으면 앞 시험이 접어 둔 상태에서 시작해, 누르는 순간 "펴기"가 된다.
 *   (실제로 그렇게 짜서 두 시험이 순서에 따라 뒤집혔다.)
 */
const freshFold = () => localStorage.clear()

const withFolders = () => ({
  ...healthy(),
  ide: {
    windows: [], liveWindows: 0, staleLocks: 0,
    folders: [
      { folders: 'c:/a', startedHere: 2, sessionCount: 2, running: 1, watch: 1 },
      { folders: 'c:/b', startedHere: 0, sessionCount: 0, running: 0, watch: 0 },
      { folders: 'c:/c', startedHere: 0, sessionCount: 3, running: 0, watch: 0 },
    ],
  },
})

/* ── 요약 묶음마다 접기 ──────────────────────────────────────── */

const firstGroup = () => cell.get('tiles').children[0]

test('처음에는 펴져 있다', () => {
  freshFold()
  drawTiles(healthy())
  const g = firstGroup()
  assert.ok(!g.classList.contains('folded'))
  assert.equal(g.children[0].getAttribute('aria-expanded'), 'true')
  assert.ok(g.children.length > 1, '머리줄 말고 내용이 있어야 한다')
})

test('🔴 머리줄을 누르면 접힌다', () => {
  freshFold()
  drawTiles(healthy())
  const g = firstGroup(), h = g.children[0]
  h.fire('click')
  assert.ok(g.classList.contains('folded'), '접힘이 클래스로 표시돼야 한다 (CSS 가 그것으로 숨긴다)')
  assert.equal(h.getAttribute('aria-expanded'), 'false')
  h.fire('click')
  assert.ok(!g.classList.contains('folded'), '다시 눌러 펴져야 한다')
})

test('🔴 접어 둔 것은 다시 그려도 접혀 있다 (3초마다 펴지면 접은 의미가 없다)', () => {
  freshFold()
  drawTiles(healthy())
  const name = firstGroup().children[0].textContent
  firstGroup().children[0].fire('click')
  drawTiles(healthy())     // 갱신
  const g = firstGroup()
  assert.equal(g.children[0].textContent, name, '같은 묶음을 보고 있어야 한다')
  assert.ok(g.classList.contains('folded'), '기억하지 않으면 3초마다 펴진다')
})

test('🔴 머리줄 이름이 화살표에 오염되지 않는다 (이름으로 찾는 코드·시험이 어긋난다)', () => {
  freshFold()
  drawTiles(healthy())
  for (const g of cell.get('tiles').children) {
    const name = g.children[0].textContent
    assert.ok(!/[▾▸]/.test(name), `묶음 이름에 화살표가 섞였다: ${JSON.stringify(name)}`)
    assert.ok(name.trim().length > 0, '이름이 비면 안 된다')
  }
})

test('키보드로도 접힌다 (머리줄이 단추 역할을 한다)', () => {
  freshFold()
  drawTiles(healthy())
  const g = firstGroup(), h = g.children[0]
  assert.equal(h.getAttribute('role'), 'button')
  assert.equal(h.getAttribute('tabindex'), '0')
  h._on.keydown({ key: 'Enter', preventDefault() { }, target: h })
  assert.ok(g.classList.contains('folded'))
})

/* ── 열린 폴더 접기 ──────────────────────────────────────────── */

test('🔴 접어도 **요지가 남는다** — 폴더 수와 세션 없는 폴더 수', () => {
  freshFold()
  const d = withFolders()
  drawFolders(d)
  const box = cell.get('folders')
  const head = box.children[0]
  assert.match(head.textContent, /열린 폴더 3개/)
  assert.ok(box.children.length > 1, '펴진 상태에서는 폴더 줄이 보여야 한다')

  head.fire('click')
  const box2 = cell.get('folders')
  assert.ok(box2.classList.contains('folded'))
  assert.equal(box2.children.length, 1, '접으면 머리줄만 남는다')
  assert.match(box2.children[0].textContent, /열린 폴더 3개/, '접어도 몇 개인지는 말해야 한다')
  assert.match(box2.children[0].textContent, /세션 없는 폴더/, '세션 없는 폴더가 몇 개인지도 남아야 한다')
  assert.match(box2.children[0].textContent, /1/, 'c:\/b 하나만 세션이 없다')
})

test('접어 둔 것은 다시 그려도 접혀 있다', () => {
  freshFold()
  const d = withFolders()
  drawFolders(d)
  cell.get('folders').children[0].fire('click')
  drawFolders(d)
  assert.equal(cell.get('folders').children.length, 1)
})

test('폴더가 없으면 아예 숨긴다 (빈 묶음이 자리를 먹지 않는다)', () => {
  freshFold()
  drawFolders({ ...healthy(), ide: { windows: [], liveWindows: 0, staleLocks: 0, folders: [] } })
  assert.ok(cell.get('folders').classList.contains('hide'))
})

/* ── 경보는 접히지 않는다 ────────────────────────────────────── */

test('🔴 경보는 접히는 묶음 바깥에 있다 (접은 채로 "감시 끊김"이 숨으면 안 된다)', async () => {
  freshFold()
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const html = readFileSync(fileURLToPath(new URL('../src/ui/index.html', import.meta.url)), 'utf8')
  const alertsAt = html.indexOf('id="alerts"')
  const topAt = html.indexOf('id="top"')
  assert.ok(alertsAt > 0 && topAt > 0)
  assert.ok(alertsAt < topAt, '경보가 접히는 묶음 안으로 들어갔다')
  assert.ok(!/id="alerts"[^>]*class="[^"]*grp/.test(html), '경보에 접히는 클래스를 붙이면 안 된다')
})
