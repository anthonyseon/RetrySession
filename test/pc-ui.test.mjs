/**
 * pc-ui.test.mjs — PC 설정 모달을 **정말 그려보고**, 고른 값이 어떻게 나가는지 본다.
 *
 * 🔴 왜 따로 있나
 *   pc.test.mjs 는 판정과 소스 규칙을 본다. 여기는 **화면**이다 — 드롭다운이 실제로
 *   생기는가, 현재 값이 골라져 있는가, 3초 폴링이 고르던 값을 지우지 않는가.
 *   소스 정규식으로는 이 중 아무것도 못 본다. 실제로 있었던 결함이 그 부류였다:
 *   권장값이 이미 맞는 PC 에서는 단추가 아예 안 나와 **설정 창이 읽기 전용**이었다.
 *
 * 하네스를 첫 줄에서 가져와야 한다 — 전역 DOM 을 깔고 나서 화면 모듈이 평가된다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareRender, healthy, ROOT } from './_ui-harness.mjs'
import { pcVerdict, choices, editableKeys } from '../src/lib/pc.mjs'
import { styleSource } from './_ui-files.mjs'

/**
 * 이 PC 의 실제 모양을 본뜬 표본 (실측 2026-09-22):
 *   전원 연결 절전 = 안 함 · 최대 절전 = 사용 불가 · 덮개 = 전원 구성에 없음(null)
 *   → 권장값으로 고칠 것이 **0개**다. 바로 그 상태에서 설정이 가능해야 한다.
 */
const raw = (over = {}) => ({
  ok: true, hibernateAvailable: false, hasBattery: true, lockedNow: false,
  standbyAc: 0, hibernateAc: null, lidAc: null,
  standbyDc: 900, hibernateDc: null, lidDc: null,
  ...over,
})

/** 서버가 /api/status 에 담아 보내는 모양 그대로 (선택지·쓸수있는키는 lib 에서 온다) */
const sample = (over) => ({
  ...pcVerdict(raw(over)),
  choices, editableKeys,
  backup: { exists: false },
  guide: ['제어판 > 전원 옵션'],
})

const openAndDraw = (pc) => {
  const h = prepareRender()
  h.S.state = { pc }
  h.config.openSettings()
  return h
}
const selects = (h) => h.cell.get('setupBody').querySelectorAll('select.pcsel')
const findCell = (h, key) => selects(h).find((s) => s.dataset.key === key) || null

/* ── 원값 — 화면이 "지금 무엇이 골라져 있나"를 말할 수 있어야 한다 ── */

test('🔴 판정이 원시 값을 함께 준다 (없으면 드롭다운이 현재 값을 표시할 수 없다)', () => {
  const p = pcVerdict(raw({ standbyAc: 900, standbyDc: 1800, lidAc: 1, hibernateAvailable: true, hibernateAc: 0 }))
  const value = Object.fromEntries(p.items.map((x) => [x.key, x.raw]))
  assert.equal(value.standbyAc, 900)
  assert.equal(value.hibernateAc, 0)
  assert.equal(value.lidAc, 1)
  assert.equal(value.standbyDc, 1800)
})

test('🔴 못 읽은 값은 원값이 없다 (0 과 "모름"을 섞으면 안 함으로 보인다)', () => {
  const p = pcVerdict(raw())      // lidAc: null · 최대 절전 사용 불가
  const value = Object.fromEntries(p.items.map((x) => [x.key, x.raw]))
  assert.equal(value.lidAc, null, '읽지 못한 덮개 값이 0 으로 둔갑하면 안 된다')
  assert.equal(value.hibernateAc, null, '사용 불가인 설정에 값을 만들어 주면 안 된다')
  assert.equal(value.standbyAc, 0)
})

/* ── 그려본다 ────────────────────────────────────────────────── */

test('🔴 고칠 것이 0개인 PC 에서도 고르는 칸이 있다 (읽기 전용 설정 창이 실제 결함이었다)', () => {
  const pc = sample()
  assert.equal(pc.fixable.length, 0, '표본 자체가 "이미 권장값" 상태여야 의미가 있다')
  const h = openAndDraw(pc)
  try {
    const keys = selects(h).map((s) => s.dataset.key)
    assert.deepEqual(keys, ['standbyAc', 'standbyDc'], '읽을 수 있는 항목에는 칸이 있어야 한다')

    const foot = h.cell.get('setupFoot').textContent
    assert.match(foot, /고른 값 적용/, '고를 수 있으면 적용 단추가 있어야 한다')
    assert.doesNotMatch(foot, /자동으로 바꿀 것이 없습니다/,
      '고칠 것이 없다는 말로 설정 창을 끝내면 사람은 바꿀 방법을 못 찾는다')
  } finally { h.restored() }
})

test('🔴 값을 못 읽은 항목에는 칸을 주지 않는다 (powercfg 가 성공한 척한다 — 실측)', () => {
  const h = openAndDraw(sample())
  try {
    assert.equal(findCell(h, 'lidAc'), null, '전원 구성에 없는 덮개 항목은 고르게 하면 안 된다')
    assert.equal(findCell(h, 'hibernateAc'), null, '사용 불가인 최대 절전도 고르게 하면 안 된다')
    assert.equal(findCell(h, 'logon'), null, '로그온 줄은 바꿀 수 있는 설정이 아니다')
  } finally { h.restored() }
})

test('덮개를 읽을 수 있는 PC 에서는 덮개도 고를 수 있다', () => {
  const h = openAndDraw(sample({ lidAc: 1 }))
  try {
    const sel = findCell(h, 'lidAc')
    assert.ok(sel, '읽을 수 있으면 칸이 있어야 한다')
    assert.equal(sel.value, '1')
    assert.deepEqual(sel.children.map((o) => o.textContent),
      ['아무 것도 안 함', '절전', '최대 절전', '시스템 종료'])
  } finally { h.restored() }
})

test('🔴 현재 값이 골라진 채로 그려진다', () => {
  const h = openAndDraw(sample({ standbyAc: 900 }))
  try {
    const sel = findCell(h, 'standbyAc')
    assert.equal(sel.value, '900')
    const selectedOpts = sel.children.filter((o) => o.selected).map((o) => o.textContent)
    assert.deepEqual(selectedOpts, ['15분 뒤'], '정확히 하나가, 현재 값으로 골라져 있어야 한다')
  } finally { h.restored() }
})

test('🔴 보기에 없는 현재 값도 그대로 보여준다 (첫 보기로 대신 표시하면 화면이 거짓말한다)', () => {
  const h = openAndDraw(sample({ standbyAc: 1200 }))   // 20분 — 보기에 없다
  try {
    const sel = findCell(h, 'standbyAc')
    assert.equal(sel.value, '1200')
    const selectedOpts = sel.children.filter((o) => o.selected)
    assert.equal(selectedOpts.length, 1)
    assert.match(selectedOpts[0].textContent, /20분 뒤 \(현재 값\)/)
    assert.equal(h.config.chosenValues().changed.length, 0, '아무것도 안 골랐으면 바뀐 것도 없어야 한다')
  } finally { h.restored() }
})

/* ── 고른 값 ─────────────────────────────────────────────────── */

test('🔴 손대지 않은 항목은 보내지 않는다', () => {
  const h = openAndDraw(sample())
  try {
    assert.deepEqual(h.config.chosenValues(), { values: {}, changed: [] })
  } finally { h.restored() }
})

test('🔴 고른 것만 보낸다 · 감시가 멎을 수 있으면 그 사실을 함께 담는다', () => {
  const h = openAndDraw(sample())
  try {
    const sel = findCell(h, 'standbyAc')
    sel.value = '600'
    sel.fire('change')

    const { values, changed } = h.config.chosenValues()
    assert.deepEqual(values, { standbyAc: 600 }, '배터리 항목까지 함께 덮어쓰면 안 된다')
    assert.equal(changed.length, 1)
    assert.equal(changed[0].prev, '안 함')
    assert.equal(changed[0].after, '10분 뒤')
    assert.match(changed[0].warnText, /잠들어/, '잠들면 감시가 멎는다는 것을 확인 창에 적어야 한다')
  } finally { h.restored() }
})

test('배터리도 직접 고를 수 있다 — 자동 적용은 여전히 AC 만 건드린다', () => {
  const h = openAndDraw(sample())
  try {
    const sel = findCell(h, 'standbyDc')
    sel.value = '0'
    sel.fire('change')
    assert.deepEqual(h.config.chosenValues().values, { standbyDc: 0 })
    // 자동(권장값) 경로에는 배터리가 절대 들어가지 않는다
    const p = pcVerdict(raw({ standbyAc: 900, standbyDc: 900 }))
    assert.deepEqual(p.fixable, ['standbyAc'])
  } finally { h.restored() }
})

/* ── 3초 폴링이 고르던 값을 지우지 않는다 ────────────────────── */

test('🔴 다시 그려도 고른 값이 남는다 (폴링이 선택을 되돌리면 설정을 할 수 없다)', () => {
  const h = openAndDraw(sample())
  try {
    const sel = findCell(h, 'standbyAc')
    sel.value = '1800'
    sel.fire('change')

    // 상태를 새로 받은 것처럼 (내용은 그대로) — app.js 가 3초마다 이렇게 부른다
    h.S.state = { pc: sample() }
    h.config.drawSettings()
    assert.equal(findCell(h, 'standbyAc').value, '1800', '내용이 같으면 다시 그릴 이유가 없다')

    // 내용이 바뀌어 정말 다시 그려도 고른 값은 살아 있어야 한다
    h.S.state = { pc: sample({ standbyDc: 3600 }) }
    h.config.drawSettings()
    const again = findCell(h, 'standbyAc')
    assert.equal(again.value, '1800')
    assert.deepEqual(h.config.chosenValues().values, { standbyAc: 1800 })
  } finally { h.restored() }
})

test('창을 새로 열면 고르던 값은 비워진다 (닫았다 열면 지금 상태가 보여야 한다)', () => {
  const h = openAndDraw(sample())
  try {
    const sel = findCell(h, 'standbyAc')
    sel.value = '600'
    sel.fire('change')
    h.config.openSettings()
    assert.equal(findCell(h, 'standbyAc').value, '0')
    assert.deepEqual(h.config.chosenValues().changed, [])
  } finally { h.restored() }
})

/* ── 순수 판정 ───────────────────────────────────────────────── */

test('mayStopWatching — 0(안 함)만 안전하다', () => {
  const { mayStopWatching } = prepareRender().config
  assert.equal(mayStopWatching('standbyAc', 0), '')
  assert.equal(mayStopWatching('lidAc', 0), '')
  assert.match(mayStopWatching('standbyAc', 600), /잠들어/)
  assert.match(mayStopWatching('hibernateAc', 600), /최대 절전/)
  assert.match(mayStopWatching('standbyDc', 600), /배터리/)
  assert.match(mayStopWatching('lidAc', 1), /덮개/)
  assert.equal(mayStopWatching('logon', 1), '', '모르는 키에 경고를 지어내지 않는다')
})

/* ── 화면이 규칙을 두 벌로 만들지 않는다 ─────────────────────── */

test('🔴 화면은 고른 값을 /api/pc 에 보내고, 무엇이 바뀌는지 적어 확인받는다', () => {
  // PC 를 바꾸는 길은 모달과 같은 조각에 있다 (setup.js) — 사건 배선만 app.js 다
  const app = readFileSync(join(ROOT, 'src', 'ui', 'setup.js'), 'utf8')
  assert.match(app, /action: 'set', values/, "고른 값은 action:'set' 으로 나가야 한다")
  assert.match(app, /confirm\(\[/, '남의 PC 설정이다 — 확인을 받아야 한다')
  assert.match(app, /x\.name}: \$\{x\.prev} → \$\{x\.after}/,
    '무엇이 무엇으로 바뀌는지 줄 단위로 적어야 한다 (뭉뚱그린 물음은 읽히지 않는다)')
  assert.match(app, /감시를 멎게 할 수 있습니다/, '감시가 멎을 수 있으면 말해야 한다')
})

/**
 * 🔴 주석은 걷어내고 본다. 이 저장소에서 이미 두 번 당했다 —
 *   "powercfg 가 성공한 척한다"고 **적어 둔 주석**이 금지 검사에 걸리고,
 *   자기 자신을 찾는 검사가 통과해 버렸다. 검사는 코드를 봐야 한다.
 */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')

test('🔴 화면은 powercfg 를 직접 부르지 않는다 (안전장치는 src/pc.mjs 한 곳에만)', () => {
  for (const f of ['app.js', 'setup.js']) {
    const s = codeOnly(readFileSync(join(ROOT, 'src', 'ui', f), 'utf8'))
    assert.doesNotMatch(s, /powercfg|pc-settings\.ps1/, `${f} 가 규칙을 두 벌로 만들면 안 된다`)
  }
  const server = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')
  assert.match(server, /validateValue\(k, v\)/, '브라우저에서 온 값은 서버가 다시 검증해야 한다')
  assert.match(server, /'src', 'pc\.mjs'/, '서버도 powercfg 를 직접 부르지 않는다')
})

test('고르는 칸에 CSS 가 있다 (스타일 없는 select 는 배경과 구별되지 않는다)', () => {
  const html = styleSource()
  assert.match(html, /select\.pcsel\{/)
  assert.match(html, /\.srow2 \.ed\{/)
})

/* ── 요약의 PC 묶음 ─────────────────────────────────────────── */

/**
 * 🔴 실측 결함 (2026-09-22, 사용자 보고: "세션 목록에 아무 것도 없다")
 *
 *   요약의 PC 묶음에 죽은 코드가 남아 `ReferenceError: 백업 is not defined` 를 냈다.
 *   그리기() 는 요약을 목록보다 먼저 부르므로 **세션 목록이 통째로 비었다.**
 *
 *   왜 시험이 못 잡았나: 하네스 표본(정상())에 `pc` 가 없어서 그 갈래가 **한 번도
 *   실행되지 않았다.** 없는 값으로 그려 보면 있는 값에서 나는 고장을 못 본다.
 *   그래서 여기서 실제 응답 모양으로 그린다.
 */
test('🔴 요약의 PC 묶음이 실제 응답 모양으로 그려진다 (죽은 코드가 목록을 지웠다)', () => {
  const h = prepareRender()
  try {
    h.drawTiles({ ...healthy(), pc: sample() })      // 던지면 여기서 실패한다
    const t = h.cell.get('tiles').textContent
    assert.match(t, /PC 설정/, 'PC 묶음이 있어야 한다')
    assert.match(t, /절전 \(전원 연결\)/, '판정 줄이 그려져야 한다')
    assert.match(t, /PC 설정 열기/, '여는 단추가 있어야 한다')
    assert.doesNotMatch(t, /이전 값/,
      '보관 상태는 모달에만 있다 — 옮긴 것을 두 곳에 두면 한쪽이 죽은 코드가 된다')
  } finally { h.restored() }
})

test('PC 설정을 못 읽어도 요약이 그려진다 (모를 때가 가장 자주 그려지는 모양이다)', () => {
  const h = prepareRender()
  try {
    for (const pc of [pcVerdict(null), pcVerdict({ ok: false, error: 'powershell 없음' }), { items: [] }, {}]) {
      h.cell.clear()
      h.drawTiles({ ...healthy(), pc })
    }
  } finally { h.restored() }
})

/* ── 서버 쪽 (pc.test.mjs 가 400줄을 넘어 옮겨 왔다) ──────────── */

const serverSrc = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')

/* ── 서버 쪽 ─────────────────────────────────────────────────── */

/**
 * 🔴 구간을 **길이로 자르지 않는다.**
 *   `slice(i, i + 900)` 이었다. 처리기에 action:'set' 한 갈래가 붙자 그 900자 안에
 *   있던 `windowsHide`·`캐시비우기` 가 밖으로 밀려나 시험 넷이 한꺼번에 깨졌다 —
 *   코드는 멀쩡한데 자를 위치가 틀렸을 뿐이다. 다음 경로가 시작되는 곳까지 자른다.
 */
const pcSection = () => {
  const i = serverSrc.indexOf("p === '/api/pc'")
  assert.ok(i > 0, '/api/pc 가 있어야 한다')
  const j = serverSrc.indexOf("p === '/api/run'", i)
  assert.ok(j > i, '다음 경로를 찾아야 구간을 정할 수 있다')
  return serverSrc.slice(i, j)
}

test('🔴 서버는 규칙을 두 벌로 만들지 않는다 — src/pc.mjs 를 부른다', () => {
  assert.match(pcSection(), /'src', 'pc\.mjs'/, '백업·재확인 규칙이 있는 그 스크립트를 불러야 한다')
  assert.ok(!/powercfg/.test(serverSrc), '서버가 직접 powercfg 를 부르면 안전장치를 건너뛴다')
})

test('🔴 action 은 apply·restore·set 만 받는다', () => {
  const section = pcSection()
  assert.match(section, /b\.action === 'restore'\) args2 = \['--restore'\]/)
  assert.match(section, /b\.action === 'apply'\) args2 = \['--apply'\]/)
  assert.match(section, /b\.action === 'set'\)/)
  assert.match(section, /if \(!args2\) return json\(res, 400/, '다른 값은 거절해야 한다')
})

test("🔴 action:'set' 의 값은 서버가 다시 검증한다 (화면을 거치지 않는 요청이 있다)", () => {
  const section = pcSection()
  assert.match(section, /validateValue\(k, v\)/, '브라우저가 보낸 값을 그대로 인자로 넘기면 안 된다')
  assert.match(section, /bad\.length\) return json\(res, 400/, '쓸 수 없는 값은 거절해야 한다')
  assert.match(section, /!good\.length\) return json\(res, 400/, '빈 요청도 거절해야 한다')
  assert.match(section, /args2 = \['--set', \.\.\.good\]/, '검증을 통과한 값만 넘겨야 한다')
})

test('🔴 바꾼 뒤 캐시를 버린다 (안 버리면 화면이 옛 값을 보여준다)', () => {
  const section = pcSection()
  assert.match(section, /clearCache\(\)/)
  assert.match(section, /pcState\(\{ force: true \}\)/, '응답에는 새로 읽은 값을 담아야 한다')
})

test('🔴 창을 띄우지 않고 부른다', () => {
  assert.match(pcSection(), /windowsHide: true/)
})
