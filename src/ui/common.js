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
const compact = (v) => {
  const x = Number(v) || 0
  if (Math.abs(x) >= 1e9) return (x / 1e9).toFixed(1) + 'B'
  if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(1) + 'M'
  if (Math.abs(x) >= 1e4) return (x / 1e3).toFixed(1) + 'K'
  return n(x)
}
const shortPath = (p) => String(p || '').replace(/^.*[\\/]Cnthoth-Dev[\\/]/i, '…/').replace(/\\/g, '/')

const S = {
  state: null, detail: null, picked: new Set(), openSession: null,
  tab: 'now', auto: true, lastOkAt: 0, error: null, onlyRegistered: false, lastDetailKey: null,
  // 값을 못 읽은 것(오류)과 그리다 죽은 것(그리기오류)은 다른 고장이다
  drawError: null,
}


/* ── 배지 ────────────────────────────────────────────────────── */
/**
 * @param label 🔴 **단어**로 쓴다 — 목록은 훑는 자리다. 문장은 줄을 밀어내고,
 *   밀린 줄은 읽히지 않는다. 자세한 사정은 상세의 판정 패널이 문장으로 말한다.
 * @param why   길게 적을 근거(hover). 🔴 **여기에만** 두면 안 된다 —
 *   hover 는 마우스가 있어야 보이고 인쇄도 안 된다. 보이는 곳에 이미 있는 것을
 *   한 번 더 놓는 자리다(상세의 판정 패널·재시작 로그).
 */
function badge(kind, icon, label, why) {
  const b = el('span', 'badge ' + kind)
  b.append(el('i', 'ic', icon), el('span', null, label))
  if (why) b.title = why
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
const bottomSlack = 24 // px. 스크롤바를 끝까지 내리지 않아도 "바닥"으로 본다

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
const drawnOnce = new Set()

/** 시험용 — 첫 렌더 기록을 지운다 */
export const resetFirstRender = () => drawnOnce.clear()

function keepScroll(sel, redraw, { toTop = false } = {}) {
  const box = $(sel)
  if (!box) { redraw(); return }

  const firstDraw = !drawnOnce.has(sel)
  drawnOnce.add(sel)
  if (firstDraw) { redraw(); box.scrollTop = 0; return }

  const prev = box.scrollTop
  const wasAtBottom = box.scrollHeight - box.clientHeight - prev <= bottomSlack

  redraw()

  // 다른 세션·다른 탭으로 옮겼으면 이전 위치를 되돌리는 게 오히려 이상하다
  if (toTop) { box.scrollTop = 0; return }

  // 레이아웃이 확정된 뒤에 되돌린다
  if (wasAtBottom) box.scrollTop = box.scrollHeight
  else box.scrollTop = Math.min(prev, Math.max(0, box.scrollHeight - box.clientHeight))
}


/**
 * 동작 등록소. app.js 가 기동할 때 채운다.
 * 조각들은 `동작.상세읽기()` 처럼 꺼내 쓴다 — 직접 import 하면 순환이 된다.
 */
export const actions = {
  draw: () => { },
  loadStatus: async () => { },
  loadDetail: async () => { },
  post: async () => { },
  meta: () => ({}),
  /** 누른 결과를 동작줄에 적는다 — 반응 없는 화면은 고장난 화면과 구별되지 않는다 */
  say: () => { },
}

/**
 * 🔴 조각 하나가 던져도 **화면 전체를 잃지 않는다.**
 *
 *   실측 결함 (2026-09-22): summary.js 에 죽은 코드가 남아 ReferenceError 를 냈다.
 *   그리기() 는 `타일들(d)` 을 `목록(d)` 보다 먼저 부르므로, 요약이 던지자
 *   **세션 목록이 통째로 비었다** — 서버는 8개를 정상으로 돌려주고 있었는데.
 *   사람에게는 "세션이 하나도 없다"로 보인다. 감시 장치가 조용히 아무것도
 *   안 보여주는 것, 그게 이 저장소가 계속 고쳐 온 최악이다.
 *
 * 🔴 잡은 것을 **숨기지 않는다.** 삼켜서 넘기면 다음 사람은 원인을 못 찾는다.
 *   실패한 조각의 이름과 메시지를 돌려주고, 부르는 쪽이 화면에 적는다.
 */
export function drawPiece(name, f) {
  try { f(); return null } catch (e) {
    // 콘솔에는 자취(stack)를 남긴다 — 화면에는 한 줄만 적는다
    console.error(`[화면] ${name} 그리기 실패`, e)
    return `${name}: ${e?.message || e}`
  }
}

export { $, el, n, compact, shortPath, S, badge, keepScroll }

