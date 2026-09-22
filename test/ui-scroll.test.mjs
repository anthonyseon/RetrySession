/**
 * ui-scroll.test.mjs — 다시 그릴 때 스크롤이 어디로 가는가.
 *
 * 🔴 실측 결함 (2026-09-21)
 *   화면을 새로 열면 세션 목록이 **맨 아래로 내려가 있었다.**
 *
 *   원인은 "바닥에 붙어 있었으면 바닥에 붙여둔다"는 규칙이 **첫 렌더에서** 참이
 *   되어버린 것이다. 첫 렌더 때 목록은 비어 있으므로
 *     scrollHeight - clientHeight - scrollTop  =  0
 *   이고, 이 값이 바닥여유(24) 이하라서 "바닥이었다"로 판정된다. 그린 뒤
 *   scrollTop = scrollHeight 를 하니 새로 열 때마다 목록 끝으로 갔다.
 *
 *   **없던 바닥에 붙어 있을 수는 없다.** 스크롤할 것이 없었다면 보존할 위치도 없다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareRender } from './_ui-harness.mjs'
import { keepScroll, resetFirstRender } from '../src/ui/common.js'

/**
 * 스크롤 가능한 상자를 하나 준비한다.
 * 그리기준비() 가 화면(칸)을 비우므로, 그 뒤에 querySelector 로 새 상자를 얻는다.
 */
function box(sel, { contentH = 0, viewH = 300, pos = 0 } = {}) {
  prepareRender()          // 칸을 비운다
  resetFirstRender()        // "첫 렌더" 기록도 비운다 — 새 창을 연 상황이다
  const b = globalThis.document.querySelector(sel)
  b.scrollHeight = contentH
  b.clientHeight = viewH
  b.scrollTop = pos
  return b
}

/* ── 첫 렌더 ─────────────────────────────────────────────────── */

test('🔴 첫 렌더는 맨 위에서 시작한다 (비어 있던 것을 "바닥"으로 보면 안 된다)', () => {
  const b = box('#slist', { contentH: 0, viewH: 300, pos: 0 })
  keepScroll('#slist', () => { b.scrollHeight = 5000 })   // 세션 목록이 채워졌다
  assert.equal(b.scrollTop, 0,
    `새로 열었을 때 목록이 ${b.scrollTop}px 로 내려가 있다 — 맨 위여야 한다`)
})

test('🔴 첫 렌더는 보이는 높이를 아직 모를 때도 맨 위다', () => {
  // 창이 뜨는 중이면 clientHeight 가 0 일 수 있다. 그때도 바닥으로 가면 안 된다.
  const b = box('#slist', { contentH: 0, viewH: 0, pos: 0 })
  keepScroll('#slist', () => { b.scrollHeight = 5000; b.clientHeight = 300 })
  assert.equal(b.scrollTop, 0)
})

/* ── 두 번째 이후 — 보존이 살아 있어야 한다 ─────────────────── */

test('둘째 렌더부터는 읽던 위치를 지킨다 (3초마다 튕기면 읽을 수 없다)', () => {
  const b = box('#slist', { contentH: 5000, viewH: 300, pos: 0 })
  keepScroll('#slist', () => { })          // 첫 렌더 (맨 위)
  b.scrollTop = 1200                       // 사람이 내려서 읽는 중
  keepScroll('#slist', () => { })          // 3초 뒤 다시 그림
  assert.equal(b.scrollTop, 1200, '읽던 자리를 잃으면 목록을 읽을 수 없다')
})

test('🔴 바닥에 붙어 있었으면 바닥을 지킨다 (로그는 아래로 자란다)', () => {
  const b = box('#dscroll', { contentH: 1000, viewH: 300, pos: 700 })
  keepScroll('#dscroll', () => { })        // 첫 렌더
  b.scrollTop = 700                        // 바닥 (1000-300)
  keepScroll('#dscroll', () => { b.scrollHeight = 1400 })  // 로그가 자랐다
  assert.equal(b.scrollTop, 1400, '따라가지 않으면 새 줄이 화면 밖으로 밀린다')
})

test('내용이 줄어도 범위를 넘지 않는다', () => {
  const b = box('#slist', { contentH: 5000, viewH: 300, pos: 0 })
  keepScroll('#slist', () => { })
  b.scrollTop = 4000
  keepScroll('#slist', () => { b.scrollHeight = 600 })   // 세션이 줄었다
  assert.ok(b.scrollTop <= 300, `범위를 넘었다: ${b.scrollTop}`)
})

test('맨위로 를 주면 그대로 맨 위다', () => {
  const b = box('#dscroll', { contentH: 5000, viewH: 300, pos: 0 })
  keepScroll('#dscroll', () => { })
  b.scrollTop = 2000
  keepScroll('#dscroll', () => { }, { toTop: true })
  assert.equal(b.scrollTop, 0)
})

/* ── 상자마다 따로 센다 ─────────────────────────────────────── */

test('🔴 목록의 첫 렌더가 상세의 첫 렌더를 대신하지 않는다', () => {
  const a = box('#slist', { contentH: 0 })
  const b = globalThis.document.querySelector('#dscroll')
  b.scrollHeight = 0; b.clientHeight = 300; b.scrollTop = 0

  keepScroll('#slist', () => { a.scrollHeight = 5000 })
  keepScroll('#dscroll', () => { b.scrollHeight = 5000 })
  assert.equal(a.scrollTop, 0, '목록이 맨 위여야 한다')
  assert.equal(b.scrollTop, 0, '상세도 자기 첫 렌더에서 맨 위여야 한다')
})

test('없는 상자를 주면 그리기만 하고 넘어간다', () => {
  resetFirstRender()
  let wasDrawn = false
  const original = globalThis.document.querySelector
  globalThis.document.querySelector = () => null
  try {
    keepScroll('#없음', () => { wasDrawn = true })
    assert.equal(wasDrawn, true, '상자가 없어도 내용은 그려야 한다')
  } finally { globalThis.document.querySelector = original }
})
