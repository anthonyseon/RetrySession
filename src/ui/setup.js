/**
 * setup.js — '설정' 단추가 여는 PC 설정 모달.
 *
 * 왜 자기 창을 주는가
 *   여기서 하는 일은 **남의 PC 전원 설정을 바꾸는 것**이다. 요약에 단추만 곁들이면
 *   무엇을 바꾸는지·되돌릴 수 있는지가 한눈에 안 보이고, 그러면 사람은 누르지
 *   못하거나 모르고 누른다. 둘 다 나쁘다.
 *
 * 🔴 자동과 수동을 **한 화면에** 둔다.
 *   자동으로 고칠 수 있는 것과 손으로 해야 하는 것이 섞여 있다(이 PC 는 덮개
 *   항목이 전원 구성에 아예 없어 영원히 '모름'이다). 자동만 보여주면 남은 것을
 *   놓치고, 수동만 보여주면 할 수 있는 걸 안 한다.
 *
 * 🔴 권장값 적용만으로는 **설정 화면이 아니다.**
 *   실측 (2026-09-22): 이 PC 는 이미 권장값이라 `고칠것`이 0 이었고, 그래서
 *   [자동 설정] 단추조차 나오지 않았다 — 설정 창을 열면 읽기 전용이었다.
 *   그래서 항목마다 직접 고르는 칸을 둔다.
 *
 * 🔴 규칙은 여기 없다. 백업 먼저·배터리 제외·바꾼 뒤 재확인은 전부 src/pc.mjs 에
 *   있고 서버가 그것을 부른다. 화면이 따로 구현하면 안전장치를 건너뛰는
 *   두 번째 경로가 생긴다.
 */
'use strict'
import { $, el, S, badge } from './common.js'

const color = { crit: 'crit', warn: 'warn', unknown: 'off', info: 'off', ok: 'good' }
const table = { crit: '▲', warn: '▲', unknown: '?', info: 'ℹ', ok: '●' }

/** 모달이 열려 있나 — 열려 있을 때만 다시 그린다 */
export const isSettingsOpen = () => !$('#setupWrap').classList.contains('hide')

/**
 * 🔴 사람이 고르던 값은 **다시 그려도 잃지 않는다.**
 *   화면은 3초마다 상태를 다시 읽고 모달까지 다시 그린다. 그대로 두면 드롭다운을
 *   고르는 중에 선택이 되돌려진다 — 목록 스크롤·체크박스에서 이미 당한 부류다.
 *   그래서 (1) 고른 값을 여기 담아 두고, (2) 내용이 그대로면 아예 다시 그리지 않는다.
 */
const chosen = new Map()
let drawnPrint = null
let applyBtn = null

/** 적용이 끝났으면 고르던 것을 비운다 (현재 값이 곧 그 값이 된다) */
export const clearChosen = () => { chosen.clear(); drawnPrint = null }

export function openSettings() {
  $('#setupWrap').classList.remove('hide')
  $('#btnSetup').setAttribute('aria-expanded', 'true')
  clearChosen()
  drawSettings({ force: true })
}

export function closeSettings() {
  $('#setupWrap').classList.add('hide')
  $('#btnSetup').setAttribute('aria-expanded', 'false')
}

/** 그려야 할 내용의 지문 — 이게 같으면 다시 그릴 이유가 없다 */
const 지문 = (pc) => JSON.stringify([
  pc.수준, pc.고칠것, pc.백업?.있음, pc.백업?.at, (pc.안내 || []).length,
  (pc.목록 || []).map((x) => [x.키, x.수준, x.현재, x.원값]),
])

/**
 * 이 값을 고르면 **감시가 멎을 수 있나.** 순수 함수.
 *
 * 확인 창에 "무슨 일이 일어나는지"를 적기 위해 있다. 이 도구의 전부는 예약 작업이고
 * 잠든 PC 는 예약 작업을 돌리지 않는다 — 사람이 그걸 모르고 고르면 감시가 조용히 멎는다.
 * 0('안 함')만 안전하다.
 */
export function mayStopWatching(키, 값) {
  const n = Number(값)
  if (!Number.isFinite(n) || n === 0) return ''
  if (키 === 'standbyAc') return '전원이 연결돼 있어도 PC 가 잠들어 그때부터 감시가 멎습니다'
  if (키 === 'hibernateAc') return '전원이 연결돼 있어도 최대 절전에 들어 그때부터 감시가 멎습니다'
  if (키 === 'standbyDc' || 키 === 'hibernateDc') return '배터리로 쓸 때 잠들어 감시가 멎습니다 (배터리를 아끼려면 이게 맞습니다)'
  if (키 === 'lidAc' || 키 === 'lidDc') return '덮개를 닫으면 감시가 멎습니다'
  return ''
}

const chosenLabel = (sel) => {
  for (const op of sel.children || []) {
    if (String(op.value) === String(sel.value)) return op.textContent
  }
  return String(sel.value)
}

/**
 * 화면에서 고른 값 중 **실제로 바뀐 것만** 모은다.
 *
 * 🔴 손대지 않은 항목은 보내지 않는다. 화면에 보이는 값 전부를 보내면 우리가 고르지도
 *   않은 배터리 설정까지 매번 덮어쓰게 되고, 그건 사람이 시킨 일이 아니다.
 */
export function chosenValues() {
  const values = {}
  const changed = []
  const body = $('#setupBody')
  for (const sel of body.querySelectorAll('select.pcsel')) {
    const 키 = sel.dataset?.key
    const 후 = sel.value
    if (!키 || 후 === '' || 후 === null || 후 === undefined) continue
    if (String(sel.dataset.was) === String(후)) continue
    values[키] = Number(후)
    changed.push({
      키, 이름: sel.dataset.nm || 키,
      prev: sel.dataset.wasTx || sel.dataset.was,
      후: chosenLabel(sel),
      warnText: mayStopWatching(키, 후),
    })
  }
  return { values, changed }
}

/**
 * 🔴 직접 고르는 칸.
 *
 *   배터리 항목도 고를 수 있다 — **사람이 직접 고를 때만.** 우리가 알아서 배터리
 *   절전을 끄는 것은 월권이지만, 알고 고르는 것은 선택이다. (자동 적용은 여전히 AC 만)
 *
 * @returns {boolean} 칸을 만들었나
 */
function renderSelect(r, pc, x) {
  const 종류 = pc.쓸수있는키?.[x.키]
  const view = 종류 ? pc.선택지?.[종류] : null
  if (!view) return false

  /**
   * 🔴 값을 못 읽은 항목에는 칸을 주지 않는다.
   *   실측 (2026-09-22): 이 PC 의 전원 구성에는 덮개 항목이 없는데도
   *   `powercfg /setacvalueindex ... LIDACTION 0` 은 **성공을 돌려준다**
   *   (다시 읽으면 그대로 null). 고를 수 있게 해 두면 사람은 고르고, 바뀌었다고
   *   믿고, 실제로는 안 바뀐다. 모를 때는 손으로 하라고 말하는 것이 맞다.
   */
  if (!Number.isFinite(x.원값)) return false

  const sel = el('select', 'pcsel')
  sel.id = `pcsel-${x.키}`
  sel.dataset.key = x.키
  sel.dataset.was = String(x.원값)
  sel.dataset.nm = x.이름
  sel.dataset.wasTx = String(x.현재)

  const wantValue = chosen.has(x.키) ? String(chosen.get(x.키)) : String(x.원값)
  let matched = false
  for (const o of view) {
    const op = el('option', null, o.글)
    op.value = String(o.값)
    sel.append(op)
    if (String(o.값) === wantValue) { op.selected = true; matched = true }
  }
  /**
   * 보기에 없는 값(20분처럼 어중간한 값, OEM 이 쓰는 2147483647 등)도 **그대로** 보여준다.
   * 없는 값을 첫 보기로 대신 표시하면 화면이 거짓말을 한다 — 사람은 '안 함'으로
   * 돼 있다고 믿고 창을 닫는다.
   */
  if (!matched) {
    const op = el('option', null, `${x.현재} (현재 값)`)
    op.value = wantValue
    op.selected = true
    sel.append(op)
  }
  sel.value = wantValue
  sel.addEventListener('change', () => {
    chosen.set(x.키, sel.value)
    updateApplyButton()
  })

  const cell = el('div', 'ed')
  const lb = el('label', 'edl', '바꾸기')
  lb.setAttribute('for', sel.id)
  cell.append(lb, sel)
  r.append(cell)
  return true
}

/**
 * 적용 단추의 글자·활성 상태를 고른 개수에 맞춘다.
 * 🔴 모달을 다시 그리지 않고 이것만 고친다 — 다시 그리면 고르던 칸이 닫힌다.
 */
function updateApplyButton() {
  if (!applyBtn) return
  const n = chosenValues().changed.length
  applyBtn.textContent = n ? `고른 값 적용 (${n}개)` : '고른 값 적용'
  applyBtn.disabled = n === 0
  applyBtn.className = n ? 'sm primary' : 'sm'
  applyBtn.title = n
    ? '고른 값만 바꿉니다. 바꾸기 전 값을 저장하고, 바꾼 뒤 다시 읽어 확인합니다.'
    : '바꿀 값을 먼저 고르세요 — 손대지 않은 항목은 보내지 않습니다.'
}

/**
 * 모달 내용. 상태를 새로 받을 때마다 호출되지만, 내용이 같으면 그냥 돌아간다.
 * @param 강제 창을 새로 열 때처럼 무조건 다시 그려야 할 때
 */
export function drawSettings({ force = false } = {}) {
  if (!isSettingsOpen()) return
  const pc = S.상태?.pc
  const body = $('#setupBody')
  const foot = $('#setupFoot')

  if (!pc || !Array.isArray(pc.목록)) {
    body.textContent = ''; foot.textContent = ''; applyBtn = null; drawnPrint = null
    body.append(el('div', 'empty', '아직 PC 설정을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.'))
    return
  }

  const thisPrint = 지문(pc)
  if (!force && thisPrint === drawnPrint) return
  drawnPrint = thisPrint
  body.textContent = ''; foot.textContent = ''; applyBtn = null

  /* ── 왜 이걸 보는지 한 줄 ── */
  const head = el('div', 'note')
  head.textContent = '잠든 PC 는 예약 작업을 돌리지 않습니다 — 감시도 재개도 그때 멎습니다. '
    + '자동 설정은 전원이 연결된 상태만 바꾸고, 배터리는 직접 고를 때만 바꿉니다.'
  body.append(head)

  /* ── 항목별 현재/권장/고르기 ── */
  let cellCount = 0
  for (const x of pc.목록) {
    const r = el('div', 'srow2')
    r.append(el('div', 'nm', x.이름))
    const st = el('div', 'st')
    st.append(badge(color[x.수준] || 'off', table[x.수준] || '●', String(x.현재)))
    r.append(st)
    if (x.왜) r.append(el('div', 'wh', x.왜))

    /**
     * 🔴 "자동으로는 못 바꿉니다"를 **아무 줄에나 붙이지 않는다.**
     *   처음에 그렇게 했더니 이미 정상인 줄에도 그 문구가 붙어, 고칠 게 없다는
     *   뜻이 "이건 자동으로 못 고친다"는 능력 문제처럼 읽혔다(실측: 다섯 줄 전부).
     *   문제가 있을 때만 고칠 수 있는지 없는지를 말한다.
     */
    const trouble = x.수준 !== 'ok' && x.수준 !== 'info'
    const tail2 = !trouble ? ''
      : x.고칠수있나 ? ' · 자동으로 바꿀 수 있습니다'
        : ' · 자동으로는 못 바꿉니다 — 아래 수동 방법을 보세요'
    r.append(el('div', 'rec', `권장: ${x.권장}${tail2}`))

    if (renderSelect(r, pc, x)) cellCount += 1
    body.append(r)
  }

  /* ── 보관된 이전 값 — 되돌릴 수 있다는 것을 보여준다 ── */
  const 백업 = pc.백업 || {}
  const b = el('div', 'srow2')
  b.append(el('div', 'nm', '이전 값 보관'))
  const bst = el('div', 'st')
  bst.append(백업.있음 ? badge('good', '▤', '보관됨')
    : 백업.오류 ? badge('warn', '▲', '파일 손상') : badge('off', '○', '아직 없음'))
  b.append(bst)
  b.append(el('div', 'wh', 백업.있음
    ? `${백업.at} 에 ${(백업.바꾼것 || []).join(', ') || '설정'} 을 바꾸기 전 값을 저장했습니다. '되돌리기'로 복구합니다.`
    : 백업.오류
      ? 백업.오류
      : '설정을 바꾸면 바꾸기 전 값을 먼저 저장합니다. 저장에 실패하면 바꾸지 않습니다.'))
  body.append(b)

  /* ── 수동 설정 방법 (자동으로 못 바꾸는 것) ── */
  const needsManual = pc.목록.some((x) => x.수준 !== 'ok' && x.수준 !== 'info' && !x.고칠수있나)
  const 안내 = Array.isArray(pc.안내) ? pc.안내 : []
  if (안내.length) {
    const d = el('details')
    const sm = el('summary', null, needsManual
      ? '수동 설정 방법 — 자동으로 못 바꾸는 항목이 있습니다'
      : '수동 설정 방법 (직접 바꾸려면)')
    sm.style.cursor = 'pointer'
    sm.style.fontSize = '12.5px'
    d.append(sm, el('pre', 'manual', 안내.join('\n')))
    if (needsManual) d.open = true     // 할 일이 있으면 펼쳐서 보여준다
    body.append(d)
  }

  /* ── 바닥 단추 ── */
  if (cellCount) {
    applyBtn = el('button', 'sm', '고른 값 적용')
    applyBtn.type = 'button'
    applyBtn.dataset.pc = 'set'
    foot.append(applyBtn)
    updateApplyButton()
  }
  const fixCount = (pc.고칠것 || []).length
  if (fixCount) {
    const a = el('button', 'sm primary', `권장값으로 (${fixCount}개)`)
    a.type = 'button'
    a.dataset.pc = 'apply'
    a.title = '전원 연결 상태에서 잠들지 않게 합니다. 배터리는 건드리지 않고, 이전 값은 보관합니다.'
    foot.append(a)
  } else if (!cellCount) {
    foot.append(el('span', 'note', pc.수준 === 'ok'
      ? '자동으로 바꿀 것이 없습니다 — 이대로 계속 돌 수 있습니다.'
      : '자동으로 바꿀 수 있는 항목이 없습니다. 위 수동 방법을 보세요.'))
  }
  if (백업.있음) {
    const r = el('button', 'sm', '되돌리기')
    r.type = 'button'
    r.dataset.pc = 'restore'
    r.title = `보관된 값으로 되돌립니다 (${백업.at || '시각 미상'})`
    foot.append(r)
  }
  foot.append(el('span', 'spacer'))
  const c = el('button', 'sm', '닫기')
  c.type = 'button'
  c.dataset.setup = 'close'
  foot.append(c)
}
