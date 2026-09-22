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
 * 🔴 규칙은 여기 없다. 백업 먼저·배터리 제외·바꾼 뒤 재확인은 전부 src/pc.mjs 에
 *   있고 서버가 그것을 부른다. 화면이 따로 구현하면 안전장치를 건너뛰는
 *   두 번째 경로가 생긴다.
 */
'use strict'
import { $, el, S, badge, 동작 } from './common.js'

const 색 = { crit: 'crit', warn: 'warn', unknown: 'off', info: 'off', ok: 'good' }
const 표 = { crit: '▲', warn: '▲', unknown: '?', info: 'ℹ', ok: '●' }

/** 모달이 열려 있나 — 열려 있을 때만 다시 그린다 */
export const 열렸나 = () => !$('#setupWrap').classList.contains('hide')

export function 설정열기() {
  $('#setupWrap').classList.remove('hide')
  $('#btnSetup').setAttribute('aria-expanded', 'true')
  설정그리기()
}

export function 설정닫기() {
  $('#setupWrap').classList.add('hide')
  $('#btnSetup').setAttribute('aria-expanded', 'false')
}

/**
 * 모달 내용. 상태를 새로 받을 때마다 다시 그린다 —
 * 자동 설정을 누른 뒤 결과가 바로 반영되어야 한다.
 */
export function 설정그리기() {
  if (!열렸나()) return
  const pc = S.상태?.pc
  const 본문 = $('#setupBody'); 본문.textContent = ''
  const 바닥 = $('#setupFoot'); 바닥.textContent = ''

  if (!pc || !Array.isArray(pc.목록)) {
    본문.append(el('div', 'empty', '아직 PC 설정을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.'))
    return
  }

  /* ── 왜 이걸 보는지 한 줄 ── */
  const 머리 = el('div', 'note')
  머리.textContent = '잠든 PC 는 예약 작업을 돌리지 않습니다 — 감시도 재개도 그때 멎습니다. '
    + '전원이 연결된 상태만 권장하고, 배터리 설정은 건드리지 않습니다.'
  본문.append(머리)

  /* ── 항목별 현재/권장 ── */
  for (const x of pc.목록) {
    const r = el('div', 'srow2')
    r.append(el('div', 'nm', x.이름))
    const st = el('div', 'st')
    st.append(badge(색[x.수준] || 'off', 표[x.수준] || '●', String(x.현재)))
    r.append(st)
    if (x.왜) r.append(el('div', 'wh', x.왜))

    /**
     * 🔴 "자동으로는 못 바꿉니다"를 **아무 줄에나 붙이지 않는다.**
     *   처음에 그렇게 했더니 이미 정상인 줄에도 그 문구가 붙어, 고칠 게 없다는
     *   뜻이 "이건 자동으로 못 고친다"는 능력 문제처럼 읽혔다(실측: 다섯 줄 전부).
     *   문제가 있을 때만 고칠 수 있는지 없는지를 말한다.
     */
    const 문제 = x.수준 !== 'ok' && x.수준 !== 'info'
    const 꼬리 = !문제 ? ''
      : x.고칠수있나 ? ' · 자동으로 바꿀 수 있습니다'
        : ' · 자동으로는 못 바꿉니다 — 아래 수동 방법을 보세요'
    r.append(el('div', 'rec', `권장: ${x.권장}${꼬리}`))
    본문.append(r)
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
      : '자동 설정을 누르면 바꾸기 전 값을 먼저 저장합니다. 저장에 실패하면 바꾸지 않습니다.'))
  본문.append(b)

  /* ── 수동 설정 방법 (자동으로 못 바꾸는 것) ── */
  const 수동필요 = pc.목록.some((x) => x.수준 !== 'ok' && x.수준 !== 'info' && !x.고칠수있나)
  const 안내 = Array.isArray(pc.안내) ? pc.안내 : []
  if (안내.length) {
    const d = el('details')
    const sm = el('summary', null, 수동필요
      ? '수동 설정 방법 — 자동으로 못 바꾸는 항목이 있습니다'
      : '수동 설정 방법 (직접 바꾸려면)')
    sm.style.cursor = 'pointer'
    sm.style.fontSize = '12.5px'
    d.append(sm, el('pre', 'manual', 안내.join('\n')))
    if (수동필요) d.open = true     // 할 일이 있으면 펼쳐서 보여준다
    본문.append(d)
  }

  /* ── 바닥 단추 ── */
  const 고칠수 = (pc.고칠것 || []).length
  if (고칠수) {
    const a = el('button', 'sm primary', `자동 설정 (${고칠수}개)`)
    a.type = 'button'
    a.dataset.pc = 'apply'
    a.title = '전원 연결 상태에서 잠들지 않게 합니다. 배터리는 건드리지 않고, 이전 값은 보관합니다.'
    바닥.append(a)
  } else {
    바닥.append(el('span', 'note', pc.수준 === 'ok'
      ? '자동으로 바꿀 것이 없습니다 — 이대로 계속 돌 수 있습니다.'
      : '자동으로 바꿀 수 있는 항목이 없습니다. 위 수동 방법을 보세요.'))
  }
  if (백업.있음) {
    const r = el('button', 'sm', '되돌리기')
    r.type = 'button'
    r.dataset.pc = 'restore'
    r.title = `보관된 값으로 되돌립니다 (${백업.at || '시각 미상'})`
    바닥.append(r)
  }
  바닥.append(el('span', 'spacer'))
  const c = el('button', 'sm', '닫기')
  c.type = 'button'
  c.dataset.setup = 'close'
  바닥.append(c)
}
