/**
 * layout.js — 세션 영역의 **너비를 드래그로 조절**하고, **세로로 접는다.**
 *
 * 🔴 왜 필요한가
 *   세션과 상세는 고정 비율(1.05fr : 1.35fr)이었다. 그런데 사람이 보는 것은 때에 따라
 *   다르다 — 목록을 훑을 때는 왼쪽이, 대화·로그를 읽을 때는 오른쪽이 넓어야 한다.
 *   창 하나만 띄우는 도구라 창을 두 개 벌려 놓고 비교할 수도 없다.
 *
 * 🔴 접어도 **요지는 남긴다.** 접힌 세션 영역은 세로 띠로 줄어들지만 그 띠에
 *   "세션 n개" 가 그대로 보인다. 접힌 것이 "없는 것"으로 보이면 감시 장치가 스스로
 *   눈을 가리는 셈이다 — 요약 묶음·열린 폴더에서 이미 같은 규칙을 지켰다.
 *
 * 🔴 상태는 **저장된 것 하나만** 본다. 모듈에 사본을 캐싱하지 않는다 —
 *   요약 묶음 접기에서 사본과 저장소가 갈라져 시험이 순서에 따라 뒤집혔다(실측).
 *
 * 부작용이 없다 — `initLayout()` 을 불러야 배선된다. 그래야 하네스가 마음 놓고 가져온다.
 *
 * 🔴 바깥에 내보내는 것은 `initLayout` 하나다. 나머지는 안에서만 쓴다 —
 *   시험용으로 내보내면 "아무도 안 쓰는 export" 검사가 잡고, 그 검사는 옳다.
 *   접기·너비는 **사람이 누르고 끄는 길**로 시험한다(단추 클릭·포인터 사건).
 */
'use strict'
import { $ } from './common.js'

const KEY_SPLIT = 'rs.splitPx'
const KEY_FOLD = 'rs.sessionFolded'

/** 접힌 세로 띠의 너비(px). CSS 와 같은 값이어야 한다 */
const STRIP = 34
/** 양쪽이 쓸모 있으려면 이만큼은 남아야 한다 */
const MIN_SESSION = 320
const MIN_DETAIL = 420

const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* 저장 못 해도 동작은 한다 */ } }

const isSessionFolded = () => read(KEY_FOLD) === '1'
const savedSplit = () => {
  const n = Number(read(KEY_SPLIT))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 너비를 쓸 수 있는 값으로 자른다.
 *
 * 🔴 창이 좁아졌을 때 저장된 값을 그대로 쓰면 한쪽이 사라진다. 그릇 너비를 알 수
 *   없으면(측정 전) 자르지 않고 그대로 둔다 — 0 으로 잘라 버리는 것이 더 나쁘다.
 */
function clampSplit(px, boxWidth) {
  /**
   * 🔴 `Number(null)` 은 **0** 이고 `Number.isFinite(0)` 은 참이다.
   *   그래서 "저장된 값 없음"을 그냥 넘기면 0 이 최소값(320px)으로 잘려,
   *   **새로 깐 화면이 CSS 비율 대신 320px 로 굳는다.** 시험이 이것을 잡았다.
   *   없는 것과 0 은 다르다 — 먼저 가른다.
   */
  if (px === null || px === undefined || px === '') return null
  const n = Number(px)
  if (!Number.isFinite(n) || n <= 0) return null
  if (!boxWidth || boxWidth <= 0) return Math.max(MIN_SESSION, Math.round(n))
  const max = boxWidth - MIN_DETAIL
  if (max < MIN_SESSION) return null          // 창이 너무 좁다 — 비율에 맡긴다
  return Math.round(Math.min(Math.max(n, MIN_SESSION), max))
}

/**
 * 격자를 다시 쓴다. 접혀 있으면 너비는 무시하고 세로 띠로 만든다.
 * 🔴 접힘이 너비보다 **먼저**다 — 접힌 채로 드래그 값이 이기면 접기가 풀린 것처럼 보인다.
 */
function applyLayout() {
  const main = $('#main')
  if (!main) return null
  const folded = isSessionFolded()
  main.classList.toggle('sessfold', folded)

  const btn = $('#btnSessFold')
  if (btn) {
    btn.setAttribute('aria-expanded', folded ? 'false' : 'true')
    btn.title = folded ? '세션 영역 펼치기' : '세션 영역 접기'
    btn.textContent = folded ? '▸' : '▾'
  }

  if (folded) {
    main.style.gridTemplateColumns = `${STRIP}px 6px minmax(0, 1fr)`
    return STRIP
  }
  const px = clampSplit(savedSplit(), main.clientWidth)
  // 저장된 값이 없거나 못 쓰면 CSS 의 기본 비율로 되돌린다(값을 지운다)
  main.style.gridTemplateColumns = px ? `${px}px 6px minmax(0, 1fr)` : ''
  return px
}

function setSessionFolded(folded) {
  write(KEY_FOLD, folded ? '1' : '0')
  applyLayout()
}

function setSplit(px) {
  const main = $('#main')
  const n = clampSplit(px, main?.clientWidth)
  if (n === null) return null
  write(KEY_SPLIT, String(n))
  applyLayout()
  return n
}

/** 드래그로 바꾼 것을 되돌린다 (스플리터 더블클릭) */
function resetSplit() {
  try { localStorage.removeItem(KEY_SPLIT) } catch { /* 위와 같다 */ }
  applyLayout()
}

/* ── 배선 ────────────────────────────────────────────────────── */

/**
 * 🔴 드래그 중에는 격자를 **직접** 고치고 저장은 놓을 때 한 번만 한다.
 *   움직임마다 localStorage 를 쓰면 초당 수십 번이 되고, 그보다 나쁜 것은
 *   매번 applyLayout 이 도는 것이다(읽기·쓰기·클래스 토글이 겹친다).
 */
export function initLayout() {
  applyLayout()

  const bar = $('#split')
  const main = $('#main')
  if (bar && main) {
    let dragging = false
    const widthAt = (clientX) => {
      const left = main.getBoundingClientRect ? main.getBoundingClientRect().left : 0
      return clampSplit(clientX - left, main.clientWidth)
    }
    bar.addEventListener('pointerdown', (e) => {
      // 접혀 있으면 드래그로 펴지 않는다 — 접기 단추가 그 일을 한다
      if (isSessionFolded()) return
      dragging = true
      bar.classList.add('dragging')
      try { bar.setPointerCapture?.(e.pointerId) } catch { /* 가짜 DOM 에는 없다 */ }
    })
    bar.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const px = widthAt(e.clientX)
      if (px !== null) main.style.gridTemplateColumns = `${px}px 6px minmax(0, 1fr)`
    })
    const stop = (e) => {
      if (!dragging) return
      dragging = false
      bar.classList.remove('dragging')
      const px = widthAt(e?.clientX ?? 0)
      if (px !== null) setSplit(px)
    }
    bar.addEventListener('pointerup', stop)
    bar.addEventListener('pointercancel', stop)
    // 🔴 기본값으로 돌아갈 길을 준다 — 잘못 끌어 한쪽이 얇아지면 되돌릴 수 없으면 안 된다
    bar.addEventListener('dblclick', resetSplit)
    bar.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 80 : 24
      const now = savedSplit() ?? main.clientWidth * 0.44
      if (e.key === 'ArrowLeft') { e.preventDefault?.(); setSplit(now - step) }
      else if (e.key === 'ArrowRight') { e.preventDefault?.(); setSplit(now + step) }
      else if (e.key === 'Home') { e.preventDefault?.(); resetSplit() }
    })
  }

  const btn = $('#btnSessFold')
  if (btn) {
    btn.addEventListener('click', () => setSessionFolded(!isSessionFolded()))
  }

  /**
   * 창이 좁아지면 저장된 너비가 한쪽을 먹을 수 있다 — 다시 자른다.
   * 🔴 resize 는 연달아 온다. 폴링과 같은 이유로 겹치지 않게 한 박자 미룬다.
   */
  let pending = 0
  // 🔴 `window` 를 직접 쓰면 브라우저 밖(시험 하네스)에서 ReferenceError 로 죽는다.
  //   globalThis 는 어디에나 있고 브라우저에서는 window 와 같은 것이다.
  globalThis.addEventListener?.('resize', () => {
    clearTimeout(pending)
    pending = setTimeout(applyLayout, 120)
  })
}
