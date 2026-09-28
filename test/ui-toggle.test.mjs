/**
 * ui-toggle.test.mjs — **토글은 색으로도 상태를 말한다** (사용자 요청 2026-09-28).
 *
 * 🔴 왜 — 배지 `재시작 켬 · 대기` 는 검은 글씨에 작은 점만 주황이고 `재시작 꺼짐` 은 회색
 *   글씨였다. 색이 **판정**에만 쓰여서 훑을 때 **스위치가 켜졌는지**가 구별되지 않았다.
 *   그래서 채널을 나눴다: 판정은 글자·아이콘 색, 스위치는 테두리와 왼쪽 띠.
 *
 * 🔴 색만으로 나르지는 않는다. 라벨의 `켬`/`꺼짐`·화살표·`aria-expanded` 는 그대로다 —
 *   색각 이상·인쇄·스크린리더에서 색은 전달되지 않는다. 색은 단서를 하나 더 얹는 것이다.
 *   이 시험은 **둘 다** 지킨다: 색 규칙이 있는가, 그리고 말이 남아 있는가.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareRender, healthy } from './_ui-harness.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const cssAll = ['app.css', 'fold.css', 'theme.css'].map((f) => read('src', 'ui', f)).join('\n')
const html = read('src', 'ui', 'index.html')

const { cell, S } = prepareRender()
globalThis.confirm = () => true
globalThis.alert = () => { }
const { items } = await import('../src/ui/list.js')

const ID = 'aaaaaaaa-1111-2222-3333-444444444444'
const session = (over = {}) => ({
  sessionId: ID, shortId: 'aaaaaaaa', title: '제목', runKnown: true, running: false,
  activeMin: 60, userMsgs: 1, assistantMsgs: 1, toolCalls: 0, tokenSum: 0, costUSD: 0,
  todayKey: '2026-09-28', todayUserMsgs: 0, todayAssistantMsgs: 0, todayToolCalls: 0,
  todayTokenSum: 0, todayCostUSD: 0,
  mainCwd: 'c:\\x', runCwd: 'c:\\x', registered: true, tracker: { exists: false },
  watch: { on: false, verdict: null }, restart: { on: false },
  ...over,
})
const draw = (s) => { S.state = { ...healthy(), sessions: [s] }; S.picked = new Set(); items(S.state) }
const classesOf = (word) => cell.get('slist').querySelectorAll('span')
  .filter((x) => String(x.className).startsWith('badge') && (x.textContent || '').includes(word))
  .map((x) => String(x.className))

/* ── 세션 배지 ────────────────────────────────────────────────── */

test('🔴 감시 켬/꺼짐이 서로 다른 스위치 표시를 받는다', () => {
  draw(session({ watch: { on: true, verdict: { alive: true, ageMin: 4 } } }))
  assert.ok(classesOf('감시 켬').some((c) => c.includes('sw-on')), `켬에 sw-on 이 없다: ${classesOf('감시 켬')}`)
  draw(session())
  assert.ok(classesOf('감시 꺼짐').some((c) => c.includes('sw-off')), '꺼짐에 sw-off 가 없다')
})

test('🔴 재시작 켬/꺼짐도 마찬가지다 (판정 색과 무관하게)', () => {
  // 켬인데 판정이 셋으로 갈린다 — 어느 쪽이든 스위치 표시는 같아야 한다
  const gates = [
    { go: true, point: '재개지시', why: 'x' },
    { go: false, stage: 'busy', why: '도구 1개가 결과를 기다리는 중이다' },
    { go: false, stage: 'blocked', why: '연속 3회 실패' },
  ]
  for (const gate of gates) {
    draw(session({ restart: { on: true, gate } }))
    const got = classesOf('재시작 켬')
    assert.ok(got.some((c) => c.includes('sw-on')), `${gate.stage || 'go'}: sw-on 이 없다 (${got})`)
  }
  draw(session())
  assert.ok(classesOf('재시작 꺼짐').some((c) => c.includes('sw-off')), '꺼짐에 sw-off 가 없다')
})

test('🔴 색을 넣었다고 말을 빼지 않았다 (색만으로 나르지 않는다)', () => {
  draw(session({ watch: { on: true, verdict: { alive: true, ageMin: 4 } }, restart: { on: true, gate: { go: true, point: 'x', why: 'y' } } }))
  const txt = cell.get('slist').textContent
  assert.ok(txt.includes('감시 켬'), '켬이라는 말이 남아 있어야 한다')
  assert.ok(txt.includes('재시작 켬'), '켬이라는 말이 남아 있어야 한다')
  draw(session())
  const off = cell.get('slist').textContent
  assert.ok(off.includes('감시 꺼짐') && off.includes('재시작 꺼짐'), '꺼짐이라는 말이 남아 있어야 한다')
})

/* ── 규칙이 실제로 있는가 ─────────────────────────────────────── */

test('🔴 두 상태 **모두** 색 규칙이 있다 (한쪽만 칠하면 구별이 아니다)', () => {
  for (const sel of ['.badge.sw-on', '.badge.sw-off', 'button.sw-on', 'button.sw-off']) {
    assert.ok(cssAll.includes(sel), `${sel} 규칙이 없다`)
  }
  assert.match(cssAll, /\.badge\.sw-on\{[^}]*var\(--accent\)/, '켬은 강조색이어야 한다')
  assert.match(cssAll, /\.badge\.sw-off\{[^}]*(dashed|--muted)/, '꺼짐은 흐리거나 점선이어야 한다')
})

/**
 * 🔴 접기 토글은 `[aria-expanded]` 로 걸어 뒀다 — 새 토글이 생겨도 따로 손대지 않아도
 *   같은 규칙을 받는다. 조각마다 색을 다시 칠하면 반드시 하나가 빠진다.
 */
test('🔴 접기 토글도 펴짐/접힘이 색으로 갈린다', () => {
  assert.match(cssAll, /\[aria-expanded="true"\][^{]*\{[^}]*var\(--accent\)/, '펴짐에 강조색 규칙이 없다')
  assert.match(cssAll, /\[aria-expanded="false"\][^{]*\{[^}]*var\(--(muted|grid)\)/, '접힘에 흐린 색 규칙이 없다')
})

test('🔴 화면의 토글이 모두 상태를 들고 있다 (색을 걸 자리가 있어야 한다)', () => {
  /**
   * 🔴 속성 **순서를 가정하지 않는다.** 처음엔 `id="…" … class="…"` 순서로 찾다가
   *   `class` 가 앞에 있어서 헛돌았다 — 그렇게 쓴 검사기는 코드가 멀쩡한데 빨개지고,
   *   반대로 속성을 옮기면 조용히 통과한다. 태그 하나를 꺼내 놓고 그 안을 본다.
   */
  const tag = (id) => {
    const m = new RegExp(`<[a-z]+[^>]*id="${id}"[^>]*>`).exec(html)
    assert.ok(m, `${id} 를 찾지 못했다`)
    return m[0]
  }
  // 접기 토글은 aria-expanded, 켬/끔 단추는 sw-* 를 들고 시작한다
  assert.match(tag('btnTop'), /aria-expanded=/, '요약 접기 토글에 상태가 없다')
  assert.match(tag('btnSessFold'), /aria-expanded=/, '세션 접기 토글에 상태가 없다')
  assert.match(tag('btnAuto'), /class="[^"]*sw-(on|off)/, '자동갱신 토글이 색 상태를 들고 있지 않다')
  // 체크 토글은 accent-color 로 체크 자체를 강조색으로
  assert.match(cssAll, /accent-color:\s*var\(--accent\)/, '체크박스 강조색 규칙이 없다')
})

test('자동갱신 단추는 누를 때마다 색 상태가 바뀐다', () => {
  const app = read('src', 'ui', 'app.js')
  assert.match(app, /classList\.toggle\('sw-on', S\.auto\)/, '켤 때 sw-on 을 붙여야 한다')
  assert.match(app, /classList\.toggle\('sw-off', !S\.auto\)/, '끌 때 sw-off 를 붙여야 한다')
})

/**
 * 🔴 테마 단추는 **일부러 칠하지 않는다.**
 *   그 라벨은 «어둡게» 처럼 **누르면 될 상태**를 말한다. 거기에 "켬" 색을 입히면
 *   "어두운 테마가 켜져 있다"로 읽혀 지금 상태를 반대로 말하게 된다.
 *   토글이지만 라벨의 뜻이 다르므로 색 채널을 쓰지 않는다 — 이 시험이 그 결정을 지킨다.
 */
test('테마 단추에는 켬/끔 색을 입히지 않는다 (라벨이 목적지를 말한다)', () => {
  assert.ok(!/id="btnTheme"[^>]*sw-(on|off)/.test(html),
    '테마 단추에 스위치 색을 입히면 지금 상태를 반대로 말한다')
})
