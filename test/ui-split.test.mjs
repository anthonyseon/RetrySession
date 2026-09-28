/**
 * ui-split.test.mjs — 세션 영역의 **너비 드래그**와 **세로 접기.**
 *
 * (레이아웃의 CSS 약속은 ui-layout.test.mjs 가 본다. 여기는 **움직이는 것**을 본다.)
 *
 * 🔴 사람이 누르고 끄는 길로 시험한다. layout.js 는 `initLayout` 하나만 내보내므로
 *   여기서 만지는 것은 실제 화면과 같은 것들이다 — 손잡이에 포인터 사건을 보내고,
 *   접기 단추를 누른다. 내부 함수를 꺼내 부르면 "화면에서도 되는가"는 답이 안 된다.
 *
 * 🔴 접어도 **요지가 남아야** 한다. 접힌 것이 "없는 것"으로 보이면 감시 장치가
 *   스스로 눈을 가리는 셈이다 — 요약 묶음·열린 폴더와 같은 규칙이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareRender } from './_ui-harness.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
prepareRender()
const { $ } = await import('../src/ui/common.js')
const { initLayout } = await import('../src/ui/layout.js')

/**
 * 🔴 `$('#x')` 로 얻는다. 하네스의 칸은 **물어본 뒤에** 만들어지므로,
 *   내부 Map 을 먼저 들여다보면 undefined 다(그렇게 짜서 15개가 한꺼번에 깨졌다).
 */

const BOX = 1400          // main 의 너비 — 자르기 경계를 이것으로 따진다

/** 화면을 처음 상태로 세우고 배선한다 */
function mount() {
  localStorage.clear()
  const main = $('#main')
  main.clientWidth = BOX
  main._rect = { left: 0, top: 0, width: BOX, height: 800 }
  main.style.gridTemplateColumns = ''
  initLayout()
  return { main, bar: $('#split'), btn: $('#btnSessFold') }
}

/** 격자 첫 칸의 px (비율이면 null) */
const firstCol = (main) => {
  const m = /^(\d+)px/.exec(String(main.style.gridTemplateColumns || ''))
  return m ? Number(m[1]) : null
}

/** 손잡이를 잡고 x 로 끌고 놓는다 */
function drag(bar, x, { drop = true } = {}) {
  bar._on.pointerdown({ pointerId: 1, target: bar })
  bar._on.pointermove({ clientX: x })
  if (drop) bar._on.pointerup({ clientX: x })
}

/* ── 너비 드래그 ─────────────────────────────────────────────── */

test('처음에는 CSS 의 비율을 쓴다 (inline 격자를 심지 않는다)', () => {
  const { main } = mount()
  assert.equal(firstCol(main), null, '저장된 값이 없으면 비율이어야 한다')
})

test('🔴 끌면 세션 영역의 너비가 바뀐다', () => {
  const { main, bar } = mount()
  drag(bar, 600)
  assert.equal(firstCol(main), 600)
})

test('🔴 끄는 중에도 따라온다 (놓을 때만 움직이면 조절이 안 된다)', () => {
  const { main, bar } = mount()
  bar._on.pointerdown({ pointerId: 1, target: bar })
  bar._on.pointermove({ clientX: 500 })
  assert.equal(firstCol(main), 500, '움직이는 동안 반영돼야 한다')
  bar._on.pointermove({ clientX: 700 })
  assert.equal(firstCol(main), 700)
  bar._on.pointerup({ clientX: 700 })
})

test('잡지 않고 움직이면 아무 일도 없다', () => {
  const { main, bar } = mount()
  bar._on.pointermove({ clientX: 600 })
  assert.equal(firstCol(main), null)
})

test('🔴 한쪽이 사라질 만큼은 끌 수 없다 (양쪽 다 쓸모 있어야 한다)', () => {
  const { main, bar } = mount()
  drag(bar, 10)
  assert.ok(firstCol(main) >= 320, `너무 얇아졌다: ${firstCol(main)}`)
  drag(bar, BOX + 500)
  assert.ok(firstCol(main) <= BOX - 420, `상세가 사라진다: ${firstCol(main)}`)
})

test('🔴 끌어 둔 너비는 기억된다 (다시 그려도 돌아가지 않는다)', () => {
  const { main, bar } = mount()
  drag(bar, 640)
  main.style.gridTemplateColumns = ''     // 다시 그린 셈
  initLayout()
  assert.equal(firstCol(main), 640)
})

test('🔴 창이 좁아지면 저장된 너비를 다시 자른다 (한 칸이 화면을 넘지 않게)', () => {
  const { main, bar } = mount()
  drag(bar, 900)
  main.clientWidth = 800                  // 창을 좁혔다
  initLayout()
  assert.ok(firstCol(main) <= 800 - 420, `좁은 창에서 상세가 사라진다: ${firstCol(main)}`)
})

test('창이 너무 좁으면 비율에 맡긴다 (억지로 자르지 않는다)', () => {
  const { main, bar } = mount()
  drag(bar, 600)
  main.clientWidth = 500                  // 320 + 420 이 안 들어간다
  initLayout()
  assert.equal(firstCol(main), null, '이때는 CSS 의 비율·미디어쿼리가 맡는다')
})

test('더블클릭하면 기본값으로 돌아간다 (잘못 끌었을 때 되돌릴 길)', () => {
  const { main, bar } = mount()
  drag(bar, 900)
  assert.equal(firstCol(main), 900)
  bar._on.dblclick({ target: bar })
  assert.equal(firstCol(main), null)
})

test('키보드로도 조절된다 (←/→ · Shift · Home)', () => {
  const { main, bar } = mount()
  drag(bar, 600)
  bar._on.keydown({ key: 'ArrowRight', preventDefault() { } })
  assert.equal(firstCol(main), 624, '→ 는 24px 넓힌다')
  bar._on.keydown({ key: 'ArrowLeft', preventDefault() { } })
  assert.equal(firstCol(main), 600)
  bar._on.keydown({ key: 'ArrowRight', shiftKey: true, preventDefault() { } })
  assert.equal(firstCol(main), 680, 'Shift 는 크게 움직인다')
  bar._on.keydown({ key: 'Home', preventDefault() { } })
  assert.equal(firstCol(main), null, 'Home 은 기본값')
})

/* ── 세로 접기 ───────────────────────────────────────────────── */

test('🔴 단추를 누르면 세션 영역이 세로 띠로 접힌다', () => {
  const { main, btn } = mount()
  assert.ok(!main.classList.contains('sessfold'))
  assert.equal(btn.getAttribute('aria-expanded'), 'true')

  btn.fire('click')
  assert.ok(main.classList.contains('sessfold'), 'CSS 가 이 클래스로 띠를 만든다')
  assert.equal(btn.getAttribute('aria-expanded'), 'false')
  assert.equal(firstCol(main), 34, '접히면 좁은 띠가 된다')

  btn.fire('click')
  assert.ok(!main.classList.contains('sessfold'), '다시 눌러 펴져야 한다')
})

test('🔴 접힘은 기억된다 (3초마다 펴지면 접은 뜻이 없다)', () => {
  const { main, btn } = mount()
  btn.fire('click')
  main.style.gridTemplateColumns = ''
  initLayout()
  assert.ok(main.classList.contains('sessfold'))
  assert.equal(firstCol(main), 34)
})

test('🔴 접혀 있으면 접힘이 드래그한 너비를 이긴다', () => {
  const { main, bar, btn } = mount()
  drag(bar, 700)
  btn.fire('click')
  assert.equal(firstCol(main), 34, '접었는데 끌어 둔 너비가 이기면 접힌 것처럼 보이지 않는다')
  // 펴면 끌어 둔 너비가 그대로 돌아온다 — 접기가 그것을 지우지 않는다
  btn.fire('click')
  assert.equal(firstCol(main), 700)
})

test('접혀 있을 때는 손잡이를 끌어도 펴지 않는다 (펴는 일은 단추가 한다)', () => {
  const { main, bar, btn } = mount()
  btn.fire('click')
  drag(bar, 700)
  assert.equal(firstCol(main), 34)
  assert.ok(main.classList.contains('sessfold'))
})

test('단추의 화살표와 안내가 상태를 따라간다', () => {
  const { btn } = mount()
  assert.equal(btn.textContent, '▾')
  assert.match(btn.title, /접기/)
  btn.fire('click')
  assert.equal(btn.textContent, '▸')
  assert.match(btn.title, /펼치기/)
})

/* ── 접어도 요지가 남는다 ────────────────────────────────────── */

const css = () => readFileSync(join(ROOT, 'src', 'ui', 'fold.css'), 'utf8')

test('🔴 접힌 띠에도 "세션 n개" 가 남는다 (접힌 것이 없는 것으로 보이면 안 된다)', () => {
  const s = css()
  // 목록·동작줄·폴더는 숨기지만 머리줄(h2)은 남긴다
  assert.match(s, /main\.sessfold #spanel #slist\{[^}]*display:none/, '목록은 숨긴다')
  assert.ok(!/main\.sessfold #spanel > h2\{[^}]*display:none/.test(s), '머리줄을 숨기면 개수가 사라진다')
  assert.match(s, /main\.sessfold #spanel > h2\{[^}]*writing-mode:vertical/, '머리줄이 세로로 선다')
  assert.match(s, /main\.sessfold[^{]*\.badge\{ writing-mode:horizontal-tb \}/,
    '개수 배지는 바로 세워야 읽힌다')
})

test('🔴 좁은 화면에서는 손잡이를 숨기고 inline 격자를 무시한다', () => {
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.css'), 'utf8')
  const mq = app.slice(app.indexOf('@media (max-width:1100px)'))
  assert.match(mq, /grid-template-columns:1fr !important/,
    '드래그가 남긴 px 격자가 좁은 화면에서 이기면 상세가 사라진다')
  assert.match(mq, /\.splitter\{display:none\}/, '세로로 쌓인 뒤에는 손잡이가 나눌 것이 없다')
})

/**
 * 🔴 접근성 속성은 index.html 에 있다 — 하네스는 HTML 을 읽지 않으므로
 *   가짜 DOM 에서 찾으면 늘 null 이다. 그것으로 "없다"고 하면 거짓 경보다.
 *   구조는 구조가 적힌 곳에서 확인한다.
 */
test('🔴 손잡이가 separator 로 선언돼 있고 키보드로 잡힌다', () => {
  const html = readFileSync(join(ROOT, 'src', 'ui', 'index.html'), 'utf8')
  const m = /<div class="splitter"[^>]*>/.exec(html)
  assert.ok(m, '손잡이가 있어야 한다')
  assert.match(m[0], /role="separator"/)
  assert.match(m[0], /aria-orientation="vertical"/)
  assert.match(m[0], /tabindex="0"/, '키보드로 잡을 수 있어야 한다')
  assert.match(m[0], /aria-label=/, '무엇을 조절하는지 읽어줘야 한다')
})

test('🔴 접기 단추가 무엇을 접는지 가리킨다', () => {
  const html = readFileSync(join(ROOT, 'src', 'ui', 'index.html'), 'utf8')
  const m = /<button[^>]*id="btnSessFold"[^>]*>/.exec(html)
  assert.ok(m, '접기 단추가 있어야 한다')
  assert.match(m[0], /aria-expanded=/)
  assert.match(m[0], /aria-controls="spanel"/, '어느 영역을 접는지 가리켜야 한다')
})

test('🔴 브라우저 밖에서도 터지지 않는다 (window 를 직접 만지지 않는다)', () => {
  const s = readFileSync(join(ROOT, 'src', 'ui', 'layout.js'), 'utf8')
  assert.ok(!/\bwindow\./.test(s),
    'window 를 직접 쓰면 하네스에서 ReferenceError 로 죽는다 — globalThis 를 써라')
  assert.match(s, /globalThis\.addEventListener\?\./, 'resize 는 globalThis 로 붙인다')
})
