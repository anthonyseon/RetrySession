/**
 * ui-alerts.test.mjs — 경보 배너의 **접기**와 **셋까지 보이기** (사용자 요청 2026-10-01).
 *
 * 🔴 예전 규칙은 «경보는 접히지 않는다» 였다. 이유는 «접힌 채로 '감시 끊김'이 숨으면
 *   이 도구의 존재 이유가 사라진다». 접기를 넣으면서 그 **이유**를 시험으로 지킨다 —
 *   접어도 띠에 건수와 치명 경보의 제목이 남는다.
 *
 * 접기와 높이는 **사람이 누르는 길**(띠 클릭)과 **그려 보는 길**(drawAlerts)로 시험한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareRender } from './_ui-harness.mjs'
import { HTML, styleSource } from './_ui-files.mjs'

const { cell, S } = prepareRender()
const { drawAlerts, initAlertsFold, alertsCap } = await import('../src/ui/alerts.js')

const A = (level, title) => ({ code: title, level, title, desc: `${title} — 설명` })
const three = () => ({ alerts: [A('critical', '감시 끊김'), A('warning', '예약 작업 없음'), A('info', '참고')] })
const many = (k) => ({ alerts: Array.from({ length: k }, (_, i) => A(i ? 'warning' : 'critical', `경보${i + 1}`)) })

/**
 * 🔴 시험마다 처음부터 — 화면 칸 · 접힘 기억 · 오류 상태를 비우고 다시 배선한다.
 *   접힘은 기억되는 것이 요점이라, 비우지 않으면 앞 시험의 접힘을 물려받는다(ui-fold 의 교훈).
 */
function fresh() {
  prepareRender()
  S.error = null
  initAlertsFold()
}
const bar = () => cell.get('btnAlerts')
const press = () => bar().fire('click')
const txt = (id) => cell.get(id).textContent
const folded = () => cell.get('alertsWrap').classList.contains('folded')

/* ── 띠 ──────────────────────────────────────────────────────── */

test('경보가 없으면 띠도 목록도 숨는다 (접을 것이 없는 띠는 자리만 먹는다)', () => {
  fresh()
  drawAlerts({ alerts: [] })
  assert.ok(bar().classList.contains('hide'))
  assert.ok(cell.get('alerts').classList.contains('hide'))
})

test('처음에는 펴져 있고, 상태를 글자로도 말한다', () => {
  fresh()
  drawAlerts(three())
  assert.ok(!bar().classList.contains('hide'), '경보가 있으면 띠가 보여야 한다')
  assert.equal(bar().getAttribute('aria-expanded'), 'true')
  assert.equal(txt('btnAlertsTx'), '경보 접기')
  assert.equal(txt('btnAlertsIc'), '▾')
  assert.ok(!folded())
  assert.equal(cell.get('alerts').children.length, 3)
  assert.equal(txt('alertsN'), '3건')
})

test('🔴 띠를 누르면 접히고, 다시 누르면 펴진다', () => {
  fresh()
  drawAlerts(three())
  press()
  assert.ok(folded(), '접힘이 클래스로 표시돼야 한다 (CSS 가 그것으로 목록을 숨긴다)')
  assert.equal(bar().getAttribute('aria-expanded'), 'false')
  assert.equal(txt('btnAlertsTx'), '경보 펴기')
  assert.equal(txt('btnAlertsIc'), '▸')
  press()
  assert.ok(!folded(), '다시 눌러 펴져야 한다')
  assert.equal(bar().getAttribute('aria-expanded'), 'true')
})

test('🔴 접어 둔 것은 다시 그려도 접혀 있다 (3초마다 펴지면 접은 의미가 없다)', () => {
  fresh()
  drawAlerts(three())
  press()
  drawAlerts(three())     // 갱신
  assert.ok(folded(), '기억하지 않으면 3초마다 펴진다')
  assert.equal(bar().getAttribute('aria-expanded'), 'false')
  // 접힘은 목록을 비우는 것이 아니다 — 펴면 바로 보여야 한다
  assert.equal(cell.get('alerts').children.length, 3)
})

test('🔴 접어도 건수와 치명 경보의 제목이 띠에 남는다 (감시 끊김이 숨으면 안 된다)', () => {
  fresh()
  press()
  drawAlerts(three())
  assert.equal(txt('alertsN'), '3건')
  const dg = txt('alertsDigest')
  for (const w of ['치명 1', '주의 1', '정보 1', '감시 끊김']) {
    assert.ok(dg.includes(w), `접힌 띠에 '${w}' 이 없다: ${dg}`)
  }
  // 치명은 글자 색으로 나른다 — 색을 걸 자리가 있어야 한다
  const crit = cell.get('alertsDigest').querySelectorAll('span.dg-crit').map((x) => x.textContent)
  assert.ok(crit.some((t) => t.includes('감시 끊김')), `치명 제목에 강조 자리가 없다: ${crit}`)
})

test('🔴 상태를 못 읽은 것도 치명으로 띠에 남는다 (가장 급한 경보다)', () => {
  fresh()
  S.error = 'HTTP 500'
  press()
  drawAlerts(null)
  S.error = null
  assert.ok(!bar().classList.contains('hide'), '못 읽었을 때 띠가 숨으면 아무것도 모른다')
  assert.ok(txt('alertsDigest').includes('상태를 읽을 수 없습니다'))
  assert.equal(txt('alertsN'), '1건')
})

test('모르는 수준도 버리지 않고 센다 (띠의 합이 건수와 달라지면 띠를 못 믿는다)', () => {
  fresh()
  drawAlerts({ alerts: [A('weird', '이상한 것'), A('critical', '진짜')] })
  assert.equal(txt('alertsN'), '2건')
  assert.ok(txt('alertsDigest').includes('weird 1'), txt('alertsDigest'))
  assert.ok(txt('alertsDigest').includes('치명 1'))
})

test('경보 접기는 요약 접기와 다른 기억이다 (하나를 접어 다른 것이 접히면 안 된다)', () => {
  fresh()
  drawAlerts(three())
  press()
  assert.equal(localStorage.getItem('rs.alertsFolded'), '1')
  assert.equal(localStorage.getItem('rs.foldSummary'), null)
})

/* ── 셋까지 보이기 ───────────────────────────────────────────── */

const rect = { boxTop: 100, scrollTop: 0, nthBottom: 300, nthHeight: 60 }

test('셋 이하면 자르지 않는다', () => {
  assert.equal(alertsCap({ ...rect, count: 3 }), null)
  assert.equal(alertsCap({ ...rect, count: 0 }), null)
})

test('🔴 넷 이상이면 셋째 경보의 아래 끝(+간격)에서 자른다', () => {
  assert.equal(alertsCap({ ...rect, count: 4 }), 208)
  assert.equal(alertsCap({ ...rect, count: 12 }), 208, '개수가 늘어도 보이는 높이는 셋째까지다')
})

test('스크롤해 둔 상태에서 재도 같은 높이다 (스크롤하면 셋째가 위로 올라간다)', () => {
  assert.equal(alertsCap({ count: 6, boxTop: 100, scrollTop: 50, nthBottom: 250, nthHeight: 60 }), 208)
})

test('🔴 못 쟀으면 자르지 않는다 (숨은 상자를 0 으로 재면 목록이 8px 로 굳는다)', () => {
  assert.equal(alertsCap({ ...rect, count: 6, nthHeight: 0 }), null, '접혀 있을 때의 측정이다')
  assert.equal(alertsCap({ ...rect, count: 6, nthBottom: undefined }), null)
  assert.equal(alertsCap({ ...rect, count: 6, boxTop: NaN }), null)
  assert.equal(alertsCap({ count: 6 }), null)
})

test('🔴 그려 보는 길: 높이를 잴 수 있으면 셋째까지로 자르고, 못 재면 CSS 상한에 맡긴다', () => {
  fresh()
  drawAlerts(many(5))
  const box = cell.get('alerts')
  assert.equal(box.style.maxHeight, '', '가짜 DOM 은 높이가 0 이다 — 못 쟀으면 손대지 않는다')

  // 사람이 보는 화면처럼 자리를 준 뒤, 띠를 접었다 펴서(펴는 순간 다시 잰다) 확인한다
  box._rect = { left: 0, top: 100, width: 800, height: 400 }
  box.children[2]._rect = { left: 0, top: 240, width: 800, height: 60 }
  press(); press()
  assert.equal(box.style.maxHeight, 'min(208px, 50vh)')
})

test('넘친 것이 있으면 띠가 말로도 알린다 (스크롤바는 얇아서 놓친다)', () => {
  fresh()
  drawAlerts(many(5))
  assert.match(txt('alertsMore'), /3건까지/)
  assert.match(txt('alertsMore'), /나머지 2건은 스크롤/)
  drawAlerts(three())
  assert.equal(txt('alertsMore'), '', '넘치지 않으면 말하지 않는다')
})

/* ── 머리말 칩 (페이지가 구른 뒤에도 경보가 숨지 않게) ─────────── */

test('🔴 머리말 칩이 건수와 치명 수를 말하고, 경보가 없으면 숨는다', () => {
  fresh()
  drawAlerts(three())
  const chip = cell.get('hdrAlerts')
  assert.ok(!chip.classList.contains('hide'), '페이지를 내려 맨 위 경보가 밀려나도 머리말에는 남아야 한다')
  assert.match(chip.textContent, /경보 3 · 치명 1/)
  assert.match(chip.children[0].className, /crit/, '치명이 있으면 치명 색이다(아이콘·단어와 함께)')
  drawAlerts({ alerts: [A('warning', '주의만')] })
  assert.match(chip.textContent, /경보 1/)
  assert.doesNotMatch(chip.textContent, /치명/)
  drawAlerts({ alerts: [] })
  assert.ok(chip.classList.contains('hide'), '없는 경보를 칩으로 남기면 늑대 외치기다')
})

test('🔴 상태를 못 읽었을 때도 칩이 치명으로 말한다', () => {
  fresh()
  S.error = 'HTTP 500'
  drawAlerts(null)
  S.error = null
  assert.match(cell.get('hdrAlerts').textContent, /경보 1 · 치명 1/)
})

test('머리말 칩을 누르면 맨 위(경보)로 간다 — 스크롤 상자는 body 다', () => {
  fresh()
  drawAlerts(three())
  const calls = []
  globalThis.document.body = { scrollTo: (o) => calls.push(o) }
  try {
    cell.get('hdrAlerts').fire('click')
    assert.deepEqual(calls.at(-1), { top: 0, behavior: 'smooth' })
  } finally { delete globalThis.document.body }
})

/* ── 뼈대와 모양 ─────────────────────────────────────────────── */

test('🔴 띠는 경보 묶음 안, 목록 **위**에 있다 (목록과 함께 스크롤되면 단추가 사라진다)', () => {
  const html = HTML()
  const wrap = /<div class="alerts-wrap" id="alertsWrap">([\s\S]*?)<\/div>/.exec(html)
  assert.ok(wrap, '경보 묶음을 찾지 못했다')
  const btnAt = wrap[1].indexOf('id="btnAlerts"'), listAt = wrap[1].indexOf('id="alerts"')
  assert.ok(btnAt >= 0 && listAt > btnAt, '띠가 목록보다 앞에 있어야 한다')
  const tag = /<button[^>]*id="btnAlerts"[^>]*>/.exec(html)[0]
  assert.match(tag, /aria-expanded="true"/, '펼침 상태를 보조기술에도 알려야 한다')
  assert.match(tag, /aria-controls="alerts"/, '무엇을 접는지 가리켜야 한다')
  assert.match(tag, /class="sumbar[ "]/, '요약 띠와 같은 모양이어야 같은 토글로 읽힌다')
})

test('🔴 목록만 스크롤하고, 좁은 화면에서도 상한을 풀지 않는다', () => {
  const css = styleSource()
  assert.match(css, /#alerts\{[^}]*overflow-y:\s*auto/, '경보 목록이 스스로 스크롤해야 한다')
  assert.match(css, /#alerts\{[^}]*min-height:\s*0/, 'min-height:0 이 없으면 스크롤이 조용히 사라진다')
  assert.match(css, /#alerts\{[^}]*max-height:\s*50vh/, '못 쟀을 때의 상한이 있어야 한다')
  assert.match(css, /\.alert\{[^}]*flex:\s*0 0 auto/, '스크롤 상자 안에서 경보가 눌리면 글자가 잘린다')
  const narrow = /@media \(max-width:1100px\)\s*\{([\s\S]*?)\n\}/.exec(css)
  assert.ok(narrow, '좁은 화면 규칙을 찾지 못했다')
  assert.doesNotMatch(narrow[1], /alerts[^{]*\{[^}]*max-height:\s*none/,
    '좁은 화면에서 경보 상한을 풀면 경보가 세션·상세를 밀어낸다')
})

test('🔴 접힘은 목록만 숨기고, 펴진 동안에는 요지를 감추고 접힌 동안에는 넘침 안내를 감춘다', () => {
  const css = styleSource()
  assert.match(css, /\.alerts-wrap\.folded #alerts\{display:none\}/)
  assert.match(css, /\.sumbar\[aria-expanded="true"\] \.sumdigest\{display:none\}/)
  assert.match(css, /\.sumbar\[aria-expanded="false"\] \.alertsmore\{display:none\}/)
  assert.match(css, /\.dg-crit\{[^}]*--crit-ink/, '치명 제목은 치명 글자색이어야 한다')
})
