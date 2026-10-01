/**
 * alerts.js — 경보 배너. 화면 맨 위에서 **조치할 것**을 말한다.
 *
 * 왜 summary.js 에서 나왔나
 *   경보에 접기와 «셋까지 보이기» 를 넣으니(사용자 요청 2026-10-01) summary.js 가 400줄을
 *   넘게 됐다. 경보와 요약은 원래 관심사가 다르다 — 요약은 곁눈질로 보는 것이고 경보는
 *   조치할 것이다. 그래서 갈랐다. common.js 만 가져오는 **잎**이다.
 *
 * 🔴 경보는 요약과 **따로** 접힌다 — 요약(#top)을 접어도 경보는 남는다.
 *   예전 규칙은 «경보는 접히지 않는다» 였고 이유는 «접힌 채로 '감시 끊김'이 숨으면 이 도구의
 *   존재 이유가 사라진다» 였다. 경보가 쌓이면 세션·상세를 밀어내서 사용자가 접기를 요청했다.
 *   그래서 규칙을 이유에 맞춰 좁혔다: 접을 수는 있지만 **띠에 건수와 치명 경보의 제목이 남는다.**
 *
 * 부작용이 없다 — `initAlertsFold()` 를 불러야 배선된다(하네스가 마음 놓고 가져온다).
 */
'use strict'
import { $, el, S, actions, keepScroll, badge } from './common.js'

/**
 * Windows 풍선 알림 대신 여기에 띄운다.
 *
 * 풍선은 상태가 조금만 오르내려도 떠서(서버 재시작 한 번에 두 번) 진짜 경고가
 * 묻혔다. 화면 맨 위 배너는 창을 열면 바로 보이고, 조치할 곳 바로 옆에 있다.
 * 이력은 "알림" 탭에서 본다 — 창을 닫아둔 사이의 변화는 하트비트가 적어둔다.
 */
const alertIcon = { critical: '▲', warning: '▲', info: '●' }
const alertLabel = { critical: '치명', warning: '주의', info: '정보' }
const levelOrder = ['critical', 'warning', 'info']

/**
 * 한 번에 보이는 경보 수. 넘치면 **경보 목록만** 스크롤한다(사용자 요청 2026-10-01).
 *
 * 🔴 높이를 vh 로 두지 않는다. 예전 상한 28vh 는 배율 150% 화면(창 980px → CSS 약 650px)
 *   에서 182px 이라 셋째 경보가 잘렸고, 좁은 화면 규칙(1100px 이하)에서는 상한이 아예
 *   풀려 경보가 세션·상세를 밀어냈다. 경보마다 설명 길이가 달라 줄 수로 셀 수도 없다.
 *   그래서 **그려진 셋째 경보의 아래 끝**을 재서 그 높이로 자른다.
 */
const VISIBLE = 3
/** 경보 사이 간격(.alerts 의 gap) — 셋째 아래에 이만큼 남겨 넷째가 붙어 보이지 않게 한다 */
const GAP = 8

/**
 * 목록이 보일 높이(px). 순수 함수다 — 재는 일은 `fitAlerts` 가 한다.
 *
 * 🔴 못 쟀으면 null 이다. 숨은 상자(접힘·첫 렌더 전)는 높이가 0 으로 재어지는데, 그 값을
 *   그대로 쓰면 목록이 8px 로 굳는다. null 이면 CSS 상한(50vh)에 맡긴다 —
 *   잘못 자르는 것보다 조금 길게 보이는 편이 낫다.
 */
export function alertsCap({ count, boxTop, scrollTop, nthBottom, nthHeight }) {
  if (!(count > VISIBLE)) return null
  if (![boxTop, scrollTop, nthBottom, nthHeight].every(Number.isFinite)) return null
  if (nthHeight <= 0) return null
  const px = nthBottom - boxTop + scrollTop + GAP
  return px > 0 ? Math.ceil(px) : null
}

function fitAlerts() {
  const box = $('#alerts')
  if (!box) return
  const nth = box.children[VISIBLE - 1]
  const b = box.getBoundingClientRect?.()
  const r = nth?.getBoundingClientRect?.()
  const cap = alertsCap({
    count: box.children.length,
    boxTop: b?.top, scrollTop: box.scrollTop,
    // DOMRect.bottom 대신 top+height — 가짜 DOM 에는 bottom 이 없다
    nthBottom: r ? r.top + r.height : undefined, nthHeight: r?.height,
  })
  box.style.maxHeight = cap ? `min(${cap}px, 50vh)` : ''
}

/* ── 접기 ────────────────────────────────────────────────────── */

// 🔴 저장 키도 영어다 — 문자열로 들고 다니는 키는 이름 검사기가 못 본다(CLAUDE.md 2-2)
const KEY_FOLD = 'rs.alertsFolded'
const read = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, v) } catch { /* 저장 못 해도 동작은 한다 */ } }
/** 🔴 상태는 저장된 것 하나만 본다 — 모듈에 사본을 두면 시험이 순서에 따라 뒤집힌다(layout.js) */
const isFolded = () => read(KEY_FOLD) === '1'

/** 화살표 모양만으로 말하지 않는다 — 글자와 aria-expanded 로도 알린다 */
function applyFold() {
  const folded = isFolded()
  $('#alertsWrap')?.classList.toggle('folded', folded)
  const btn = $('#btnAlerts')
  if (!btn) return
  btn.setAttribute('aria-expanded', String(!folded))
  $('#btnAlertsIc').textContent = folded ? '▸' : '▾'
  $('#btnAlertsTx').textContent = folded ? '경보 펴기' : '경보 접기'
  btn.title = folded
    ? '경보를 펴면 내용 전체를 봅니다'
    : '경보를 접어도 건수와 치명 경보의 제목은 이 띠에 남습니다'
}

/**
 * 접힌 띠의 요지 — 수준별 건수, 그리고 **치명 경보의 제목**.
 *
 * 🔴 숫자만 남기면 «치명 1» 이 '감시 끊김' 인지 알 수 없다. 접기를 허락한 조건이
 *   «치명 경보의 말은 숨지 않는다» 이므로 제목을 그대로 적는다.
 * 🔴 모르는 수준도 버리지 않고 센다 — 띠의 합이 건수와 다르면 띠를 믿을 수 없다.
 */
function drawDigest(list) {
  const box = $('#alertsDigest')
  box.textContent = ''
  const levels = [...new Set([...levelOrder, ...list.map((a) => a.level)])]
  let first = true
  for (const lv of levels) {
    const k = list.filter((a) => a.level === lv).length
    if (!k) continue
    if (!first) box.append(' · ')
    first = false
    box.append(el('span', lv === 'critical' ? 'dg-crit' : null,
      `${alertIcon[lv] || '●'} ${alertLabel[lv] || lv || '기타'} ${k}`))
  }
  const crit = list.filter((a) => a.level === 'critical').map((a) => a.title)
  if (crit.length) box.append(' — ', el('span', 'dg-crit', crit.join(' · ')))
}

/**
 * 머리말의 경보 칩.
 * 🔴 페이지가 구르게 되면서(2026-10-02) 맨 위의 경보가 화면 밖으로 밀려날 수 있다. 머리말은
 *   붙어 있으므로 여기서 건수와 치명 수를 말한다 — «경보가 숨으면 안 된다» 의 이유를 지킨다.
 */
function drawHeaderChip(list) {
  const chip = $('#hdrAlerts')
  if (!chip) return
  chip.textContent = ''
  if (!list.length) { chip.classList.add('hide'); return }
  chip.classList.remove('hide')
  const crit = list.filter((a) => a.level === 'critical').length
  const kind = crit ? 'crit' : list.some((a) => a.level === 'warning') ? 'warn' : 'off'
  chip.append(badge(kind, kind === 'off' ? '●' : '▲', crit ? `경보 ${list.length} · 치명 ${crit}` : `경보 ${list.length}`))
}

/* ── 그리기 ──────────────────────────────────────────────────── */

export function drawAlerts(d) {
  const box = $('#alerts')
  const list = [...(d?.alerts || [])]

  /**
   * 🔴 상태를 못 읽은 것 자체가 가장 급한 경보다.
   *   서버가 오류로 답하면 `d` 는 낡은 것이거나 없다 — 그 말은 화면의 나머지 전부가
   *   낡았다는 뜻이다. 머리말 구석의 작은 글씨로는 그 사실이 전달되지 않고,
   *   긴 이유는 거기서 잘린다. 배너는 전폭이고 조치를 적는 자리다.
   */
  if (S.error) {
    list.unshift({
      code: '상태읽기실패', level: 'critical',
      title: '상태를 읽을 수 없습니다',
      desc: `${S.error} — 아래 내용은 마지막으로 성공한 시점의 것입니다.`,
    })
  }

  drawHeaderChip(list)

  // 경보가 없으면 띠도 숨긴다 — 접을 것이 없는 띠는 자리만 먹는다
  const bar = $('#btnAlerts')
  if (!list.length) {
    box.textContent = ''
    box.classList.add('hide'); bar?.classList.add('hide')
    return
  }
  box.classList.remove('hide'); bar?.classList.remove('hide')

  // 🔴 3초마다 통째로 다시 그린다 — 넷째 아래를 읽는 중에 맨 위로 튕기면 스크롤이 무의미하다
  keepScroll('#alerts', () => {
    box.textContent = ''
    for (const a of list) {
      const w = el('div', 'alert ' + a.level)
      w.append(el('i', 'ic', alertIcon[a.level] || '●'))
      const t = el('div', 'txt')
      t.append(el('div', 't', a.title), el('div', 'd', a.desc))
      w.append(t, el('span', 'lv', alertLabel[a.level] || a.level))
      // 세션에 딸린 경보면 눌러서 그 세션 상세로 간다 — 조치까지 한 번에
      if (a.target) {
        w.style.cursor = 'pointer'
        w.title = '이 세션의 상세 보기'
        w.addEventListener('click', () => { S.openSession = a.target; S.detail = null; actions.draw(); actions.loadDetail() })
      }
      box.append(w)
    }
    // 높이는 그린 직후, 스크롤 위치를 되돌리기 전에 잰다(keepScroll 이 새 높이로 되돌린다)
    fitAlerts()
  })

  $('#alertsN').textContent = `${list.length}건`
  // 넘친 것이 있다는 사실을 말로도 남긴다 — 스크롤바는 얇아서 놓친다
  $('#alertsMore').textContent = list.length > VISIBLE
    ? `— ${VISIBLE}건까지 보입니다 · 나머지 ${list.length - VISIBLE}건은 스크롤`
    : ''
  drawDigest(list)
  applyFold()
}

/* ── 배선 ────────────────────────────────────────────────────── */

export function initAlertsFold() {
  applyFold()
  $('#btnAlerts')?.addEventListener('click', () => {
    write(KEY_FOLD, isFolded() ? '0' : '1')
    applyFold()
    // 펴는 순간 다시 잰다 — 접혀 있는 동안은 높이가 0 이라 잴 수 없었다
    fitAlerts()
  })
  // 머리말 칩 — 맨 위(경보)로 간다. 페이지의 스크롤 상자는 body 다(app.css 의 틀)
  $('#hdrAlerts')?.addEventListener('click', () => document.body?.scrollTo?.({ top: 0, behavior: 'smooth' }))
  // 창 너비가 바뀌면 경보의 줄바꿈이 바뀌어 셋째의 아래 끝도 바뀐다.
  // 🔴 `window` 를 직접 쓰면 시험 하네스에서 ReferenceError 로 죽는다(layout.js 와 같다)
  globalThis.addEventListener?.('resize', fitAlerts)
}
