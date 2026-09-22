/**
 * detail.js — 오른쪽 상세 패널. 처리 상황·대화·로그·설정·알림 탭.
 */
'use strict'
// 🔴 n(숫자 서식)을 빠뜨려 상세 탭이 전부 ReferenceError 로 죽었다 (2026-09-22 실측).
//   app.js 를 조각으로 나눌 때 한 파일 안에 있던 이름이 import 목록에서 누락됐다.
import { $, el, n, compact, shortPath, S, badge, keepScroll, actions } from './common.js'

/** 상세를 다시 그린다. 보고 있던 세션·탭이 바뀌었으면 맨 위에서 시작한다 */
function redrawDetail() {
  const 키 = `${S.openSession || ''}|${S.tab}`
  const changed = 키 !== S.lastDetailKey
  S.lastDetailKey = 키
  keepScroll('#dscroll', drawDetail, { toTop: changed })
}


/* ── 상세 ────────────────────────────────────────────────────── */
function drawDetail() {
  const d = S.detail
  const s = S.상태?.세션.find((x) => x.sessionId === S.openSession)

  // 알림 이력은 세션 선택과 무관하다 — 창을 열자마자 볼 수 있어야 한다
  const history = S.상태?.경보이력 || []
  $('#tab-al').textContent = history.length
    ? history.join('\n')
    : '(기록된 경보 변화가 없습니다. 하트비트가 5분마다 확인하고, 상태가 바뀔 때만 여기에 남깁니다.)'

  if (!S.openSession || !d || !s) {
    $('#dbody').classList.add('hide')
    // 알림 탭은 세션 없이도 보여준다
    $('#dempty').classList.toggle('hide', S.tab === 'al')
    // 🔴 세션을 골랐는데 못 읽은 것이면 그 이유를 적는다. 안내문만 두면 사람은
    //   화면이 멈춘 줄 안다.
    $('#dempty').textContent = S.openSession && S.detailError
      ? `이 세션의 상세를 읽을 수 없습니다 — ${S.detailError}`
      : '세션 행을 누르면 처리 상황과 내용이 실시간으로 표시됩니다.'
    $('#dtitle').textContent = S.tab === 'al' ? '알림 이력' : '상세 — 왼쪽에서 세션을 고르세요'
    drawTab()
    return
  }
  $('#dempty').classList.add('hide'); $('#dbody').classList.remove('hide')
  $('#dtitle').textContent = ''
  $('#dtitle').append(
    el('span', null, s.제목 || s.짧은id),
    el('span', null, ' '),
    badge(s.실행중 ? 'good' : 'off', s.실행중 ? '▶' : '■', s.실행중 ? '실행 중' : '정지'),
    (() => { const x = el('span', 'spacer'); return x })(),
    el('code', null, s.sessionId),
  )

  if (!d.ok) { $('#tab-now').textContent = d.오류 || '상세를 읽을 수 없다'; return }

  /* 처리 상황 */
  const now = $('#tab-now'); now.textContent = ''

  if (d.진행.도구실행중) {
    const w = el('div', 'warnbox')
    w.append(el('div', null, `▲ 도구 실행 중 — 결과가 아직 안 온 호출 ${d.진행.미완결도구.length}건`))
    for (const t of d.진행.미완결도구) {
      const c = el('div', 'tchip'); c.append(el('b', null, t.이름), el('span', null, t.요지 || ''))
      w.append(c)
    }
    now.append(w, el('div', null, ' '))
  }

  const dl = el('dl', 'kv')
  const kv = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v ?? '-')) }
  kv('마지막 활동', `${d.항목.at(-1)?.at || '?'} · ${d.활성분}분 전 · 마지막 ${d.진행.마지막종류 || '?'}`)
  kv('실행 위치', shortPath(s.실행cwd))
  kv('주 작업 위치', shortPath(s.주작업cwd))
  if (s.cwd상위?.length > 1) kv('오간 위치', s.cwd상위.map((c) => `${shortPath(c.경로)} (${n(c.엔트리)})`).join('\n'))
  kv('저장소', `${s.저장소id}${s.저장소설정있음 ? ' (설정 있음)' : ' (설정 없음 — 기본값으로 돈다)'}`)
  kv('git', s.git ? `${s.git.브랜치 || '?'} · ${s.git.head || '?'} · 커밋 ${s.git.커밋수 || '?'} · 미커밋 ${s.git.미커밋파일수}` : '감시를 켜면 조회한다')
  kv('트랜스크립트', `${(d.바이트 / 1048576).toFixed(1)}MB · 꼬리 ${(d.꼬리읽음 / 1024).toFixed(0)}KB 읽음 · 항목 ${n(d.항목수)}`)
  now.append(dl)

  if (d.추적기?.ok) {
    now.append(el('h3', null, ''))
    const t2 = el('dl', 'kv')
    const kv2 = (k, v) => { t2.append(el('dt', null, k), el('dd', null, v ?? '-')) }
    kv2('추적기', `${d.재시작?.추적기경로 || ''} · ${d.추적기.완료표기}`)
    kv2('재개 지점', d.추적기.doing ? `doing ${d.추적기.doing.id} — ${d.추적기.doing.title || ''}`
      : d.추적기.다음todo ? `todo ${d.추적기.다음todo.id} — ${d.추적기.다음todo.title || ''}`
      : d.추적기.전부완료 ? '전부 done — 재개할 것이 없다' : '없음')
    if (d.추적기.doing?.evidence) kv2('근거', d.추적기.doing.evidence)
    if (d.추적기.nextAction) kv2('nextAction', d.추적기.nextAction)
    now.append(t2)
  }

  /* 사용량 표 */
  if (Object.keys(s.모델별 || {}).length) {
    const tb = el('table', 'models')
    const thead = el('thead'), hr = el('tr')
    for (const h of ['모델', '입력', '캐시쓰기', '캐시읽기', '출력', '정가']) hr.append(el('th', null, h))
    thead.append(hr); tb.append(thead)
    const body = el('tbody')
    for (const [id, t] of Object.entries(s.모델별)) {
      const r = el('tr')
      r.append(el('td', null, id + (t.추정 ? ' (추정)' : '')),
        el('td', null, compact(t.입력)), el('td', null, compact(t.캐시쓰기1h + t.캐시쓰기5m)),
        el('td', null, compact(t.캐시읽기)), el('td', null, compact(t.출력)),
        el('td', null, '$' + t.usd.toFixed(2)))
      body.append(r)
    }
    tb.append(body)
    now.append(el('div', 'note', '토큰은 트랜스크립트 실측이고 금액은 정가 환산이다. ' + (S.상태.합계.비용해석 || '')))
    now.append(tb)
  }

  /* 재시작 예산 */
  if (d.재시작) {
    const r = d.재시작, c = r.설정, b = r.예산
    const box = el('div')
    box.append(el('div', 'note', `재시작 예산 — 오늘 ${b.오늘실행}/${c.하루최대회}회 · $${b.오늘비용}/$${c.하루최대비용USD ?? '-'} · 연속실패 ${r.상태.연속실패 || 0}/${c.연속실패한계} · 권한 ${c.권한모드}`))
    const m = el('div', 'meter' + (b.오늘실행 >= c.하루최대회 ? ' crit' : b.오늘실행 / c.하루최대회 > .7 ? ' warn' : ''))
    const i = el('i'); i.style.width = Math.min(100, (b.오늘실행 / Math.max(1, c.하루최대회)) * 100) + '%'
    m.append(i); box.append(m)
    if (!b.ok) box.append(el('div', 'note', `지금 재시작하지 않는 이유: ${b.why}`))
    if (r.상태.마지막실행) {
      const L = r.상태.마지막실행
      box.append(el('div', 'note', `마지막 실행 ${L.at} · ${L.결과} · ${L.tookSec}초 · $${L.비용USD ?? 0} · 턴 ${L.turns ?? '?'}`))
      if (L.summary) box.append(el('div', 'warnbox', L.summary))
    }
    now.append(el('div', null, ' '), box)
  }

  /* 타임라인 */
  const tl = $('#tab-tl'); tl.textContent = ''
  for (const it of [...d.항목].reverse()) {
    const cls = it.종류 === '사용자' ? 'user' : it.종류 === '어시스턴트' ? 'asst' : 'tool'
    const w = el('div', 'ti ' + cls)
    const hd = el('div', 'hd')
    hd.append(el('span', 'who', it.종류), el('span', null, it.at || ''))
    if (it.모델) hd.append(el('span', null, it.모델))
    if (it.사고있음) hd.append(el('span', null, '· 사고'))
    if (it.사이드체인) hd.append(el('span', null, '· 서브에이전트'))
    if (it.토큰) hd.append(el('span', 'tok', `· 출력 ${n(it.토큰.출력)}${it.토큰.사고 ? ` (사고 ${n(it.토큰.사고)})` : ''} · 캐시읽기 ${compact(it.토큰.캐시읽기)}`))
    w.append(hd)
    if (it.글) w.append(el('div', 'body', it.글))
    if (it.결과?.length) {
      for (const r of it.결과) {
        const c = el('div', 'tchip')
        c.append(el('b', null, r.오류 ? '오류' : '결과'), el('span', null, r.요지 || ''))
        w.append(c)
      }
    }
    if (it.도구?.length) {
      const box = el('div', 'tools')
      for (const t of it.도구) {
        const c = el('div', 'tchip'); c.append(el('b', null, t.이름), el('span', null, t.요지 || ''))
        box.append(c)
      }
      w.append(box)
    }
    tl.append(w)
  }
  if (!d.항목.length) tl.append(el('div', 'empty', '최근 항목이 없다.'))

  /* 로그 */
  $('#tab-hb').textContent = (d.감시로그 || []).join('\n') || '(감시 기록이 없다 — 감시를 켜고 5분 기다리거나 “지금 감시 실행”)'
  $('#tab-rs').textContent = (d.재시작로그 || []).join('\n') || '(재시작 기록이 없다)'

  /* 설정 */
  const cfg = $('#tab-cfg'); cfg.textContent = ''
  cfg.append(el('div', 'note', '재개지시 — 추적기가 없는 세션은 이 지시가 있어야 재시작한다. 비우면 “하던 일을 이어서”가 된다.'))
  const ta = el('textarea'); ta.value = d.대상?.재개지시 || ''
  ta.placeholder = '예: _plan/todo.md 의 첫 미완 항목을 하나만 끝내고 커밋하라.'
  cfg.append(ta)
  const save = el('button', 'sm primary', '재개지시 저장')
  save.addEventListener('click', async () => {
    save.disabled = true
    await actions.post('/api/targets', { sessionIds: [S.openSession], 재개지시: ta.value, meta: actions.meta(s) })
    save.disabled = false; actions.loadDetail()
  })
  const row = el('div'); row.style.marginTop = '8px'; row.style.display = 'flex'; row.style.gap = '7px'
  row.append(save)
  const b1 = el('button', 'sm', '지금 감시 실행')
  b1.addEventListener('click', () => actions.post('/api/run', { kind: 'heartbeat' }).then(() => setTimeout(actions.loadDetail, 2500)))
  const b2 = el('button', 'sm', '지금 재시작 실행')
  b2.addEventListener('click', () => {
    if (!confirm('이 세션을 지금 재시작합니다. 사람이 보지 않는 상태로 토큰을 쓰고 파일을 고칠 수 있습니다. 계속할까요?')) return
    actions.post('/api/run', { kind: 'resume', sessionId: S.openSession }).then(() => setTimeout(actions.loadDetail, 3000))
  })
  row.append(b1, b2)
  cfg.append(row)
  cfg.append(el('div', 'note', `대상 등록 ${d.대상 ? '됨' : '안 됨'} · 감시 ${d.대상?.감시 ? 'O' : 'X'} · 재시작 ${d.대상?.재시작 ? 'O' : 'X'}`))

  drawTab()
}

function drawTab() {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === S.tab)
  for (const k of ['now', 'tl', 'hb', 'rs', 'cfg', 'al']) $('#tab-' + k).classList.toggle('hide', k !== S.tab)
  // 알림 탭에서는 세션 상세 묶음을 숨긴다 (알림은 그 바깥에 있다)
  if (S.openSession && S.detail) $('#dbody').classList.toggle('hide', S.tab === 'al')
}


export { redrawDetail }
