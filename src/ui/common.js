/**
 * common.js — 화면 조각들이 함께 쓰는 것. 여기에는 **그리는 코드를 두지 않는다.**
 *
 * 왜 나눴나
 *   app.js 가 781줄까지 자랐다(규칙은 400줄). 한 파일에 요약·목록·상세·통신이
 *   섞여 있어 어디를 고치는지 알기 어려웠고, 화면 한 조각만 시험하려 해도
 *   폴링과 이벤트 바인딩이 함께 돌았다.
 *
 * 🔴 순환 참조를 만들지 마라.
 *   그리는 조각(summary·list·detail)은 클릭에 반응해 "다시 읽어라"를 호출해야 하는데,
 *   그 함수는 app.js 에 있다. 서로 import 하면 순환이 된다.
 *   그래서 아래 `동작` 등록소를 둔다 — app.js 가 채우고, 조각들은 꺼내 쓴다.
 *   의존 방향은 언제나 app -> 조각 -> common 한 쪽이다.
 */
'use strict'

const $ = (s) => document.querySelector(s)
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n }
const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const 압축 = (v) => {
  const x = Number(v) || 0
  if (Math.abs(x) >= 1e9) return (x / 1e9).toFixed(1) + 'B'
  if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(1) + 'M'
  if (Math.abs(x) >= 1e4) return (x / 1e3).toFixed(1) + 'K'
  return n(x)
}
const 짧은경로 = (p) => String(p || '').replace(/^.*[\\/]Cnthoth-Dev[\\/]/i, '…/').replace(/\\/g, '/')

const S = {
  상태: null, 상세: null, 선택: new Set(), 열린세션: null,
  탭: 'now', 자동: true, 마지막성공: 0, 오류: null, 등록만: false, 마지막상세키: null,
}


/* ── 배지 ────────────────────────────────────────────────────── */
function badge(kind, icon, label) {
  const b = el('span', 'badge ' + kind)
  b.append(el('i', 'ic', icon), el('span', null, label))
  return b
}

/* ── 스크롤 보존 ─────────────────────────────────────────────── */
/**
 * 🔴 목록은 3초, 상세는 2초마다 통째로 다시 그린다.
 *   그대로 두면 사용자가 스크롤할 때마다 맨 위로 튕겨 읽을 수가 없다.
 *   다시 그리기 전에 위치를 재고, 그린 뒤 되돌린다.
 *
 * 바닥에 붙어 있었으면 **바닥에 붙인 채로** 둔다 — 로그·타임라인은 새 줄이
 * 아래에 쌓이므로, 위치를 그대로 복원하면 새 내용이 화면 밖으로 밀려난다.
 */
const 바닥여유 = 24 // px. 스크롤바를 끝까지 내리지 않아도 "바닥"으로 본다

/**
 * 🔴 첫 렌더는 보존할 위치가 없다 — 맨 위에서 시작한다.
 *
 *   실측 결함 (2026-09-21): 화면을 새로 열면 세션 목록이 **맨 아래로** 내려가 있었다.
 *   첫 렌더 때 상자는 비어 있어서
 *     scrollHeight - clientHeight - scrollTop = 0  (<= 바닥여유)
 *   이 되고, "바닥에 있었다"로 판정해 그린 뒤 바닥으로 보냈다.
 *   **없던 바닥에 붙어 있을 수는 없다.** 스크롤할 것이 없었으면 보존할 위치도 없다.
 *
 *   상자마다 따로 센다 — 목록의 첫 렌더가 상세의 첫 렌더를 대신하면 안 된다.
 */
const 그린적있나 = new Set()

/** 시험용 — 첫 렌더 기록을 지운다 */
export const 첫렌더초기화 = () => 그린적있나.clear()

function 스크롤유지(sel, 다시그리기, { 맨위로 = false } = {}) {
  const box = $(sel)
  if (!box) { 다시그리기(); return }

  const 첫렌더 = !그린적있나.has(sel)
  그린적있나.add(sel)
  if (첫렌더) { 다시그리기(); box.scrollTop = 0; return }

  const 이전 = box.scrollTop
  const 바닥이었나 = box.scrollHeight - box.clientHeight - 이전 <= 바닥여유

  다시그리기()

  // 다른 세션·다른 탭으로 옮겼으면 이전 위치를 되돌리는 게 오히려 이상하다
  if (맨위로) { box.scrollTop = 0; return }

  // 레이아웃이 확정된 뒤에 되돌린다
  if (바닥이었나) box.scrollTop = box.scrollHeight
  else box.scrollTop = Math.min(이전, Math.max(0, box.scrollHeight - box.clientHeight))
}


/**
 * 동작 등록소. app.js 가 기동할 때 채운다.
 * 조각들은 `동작.상세읽기()` 처럼 꺼내 쓴다 — 직접 import 하면 순환이 된다.
 */
export const 동작 = {
  그리기: () => { },
  상태읽기: async () => { },
  상세읽기: async () => { },
  보내기: async () => { },
  메타: () => ({}),
}

export { $, el, n, 압축, 짧은경로, S, badge, 스크롤유지 }

