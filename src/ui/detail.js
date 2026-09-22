/**
 * detail.js — 오른쪽 상세 패널. 처리 상황·대화·로그·설정·알림 탭.
 */
'use strict'
// 🔴 n(숫자 서식)을 빠뜨려 상세 탭이 전부 ReferenceError 로 죽었다 (2026-09-22 실측).
//   app.js 를 조각으로 나눌 때 한 파일 안에 있던 이름이 import 목록에서 누락됐다.
import { $, el, n, compact, shortPath, S, badge, keepScroll, actions } from './common.js'

/** 상세를 다시 그린다. 보고 있던 세션·탭이 바뀌었으면 맨 위에서 시작한다 */
function redrawDetail() {
  const key = `${S.openSession || ''}|${S.tab}`
  const changed = key !== S.lastDetailKey
  S.lastDetailKey = key
  keepScroll('#dscroll', drawDetail, { toTop: changed })
}


/* ── 상세 ────────────────────────────────────────────────────── */
function drawDetail() {
  const d = S.detail
  const s = S.state?.sessions.find((x) => x.sessionId === S.openSession)

  // 알림 이력은 세션 선택과 무관하다 — 창을 열자마자 볼 수 있어야 한다
  const history = S.state?.alertHistory || []
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
    el('span', null, s.title || s.shortId),
    el('span', null, ' '),
    badge(s.running ? 'good' : 'off', s.running ? '▶' : '■', s.running ? '실행 중' : '정지'),
    (() => { const x = el('span', 'spacer'); return x })(),
    el('code', null, s.sessionId),
  )

  if (!d.ok) { $('#tab-now').textContent = d.error || '상세를 읽을 수 없다'; return }

  /* 처리 상황 */
  const now = $('#tab-now'); now.textContent = ''

  if (d.progress.toolRunning) {
    const w = el('div', 'warnbox')
    w.append(el('div', null, `▲ 도구 실행 중 — 결과가 아직 안 온 호출 ${d.progress.openTools.length}건`))
    for (const t of d.progress.openTools) {
      const c = el('div', 'tchip'); c.append(el('b', null, t.name), el('span', null, t.digest || ''))
      w.append(c)
    }
    now.append(w, el('div', null, ' '))
  }

  const dl = el('dl', 'kv')
  const kv = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v ?? '-')) }
  kv('마지막 활동', `${d.item.at(-1)?.at || '?'} · ${d.activeMin}분 전 · 마지막 ${d.progress.lastKind || '?'}`)
  kv('실행 위치', shortPath(s.runCwd))
  kv('주 작업 위치', shortPath(s.mainCwd))
  if (s.cwdTop?.length > 1) kv('오간 위치', s.cwdTop.map((c) => `${shortPath(c.path)} (${n(c.entries)})`).join('\n'))
  kv('저장소', `${s.repoId}${s.hasRepoConfig ? ' (설정 있음)' : ' (설정 없음 — 기본값으로 돈다)'}`)
  kv('git', s.git ? `${s.git.branch || '?'} · ${s.git.head || '?'} · 커밋 ${s.git.commits || '?'} · 미커밋 ${s.git.uncommittedFiles}` : '감시를 켜면 조회한다')
  kv('트랜스크립트', `${(d.bytes / 1048576).toFixed(1)}MB · 꼬리 ${(d.tailRead / 1024).toFixed(0)}KB 읽음 · 항목 ${n(d.entryCount)}`)
  now.append(dl)

  if (d.tracker?.ok) {
    now.append(el('h3', null, ''))
    const t2 = el('dl', 'kv')
    const kv2 = (k, v) => { t2.append(el('dt', null, k), el('dd', null, v ?? '-')) }
    kv2('추적기', `${d.restart?.trackerFile || ''} · ${d.tracker.doneMark}`)
    kv2('재개 지점', d.tracker.doing ? `doing ${d.tracker.doing.id} — ${d.tracker.doing.title || ''}`
      : d.tracker.nextTodo ? `todo ${d.tracker.nextTodo.id} — ${d.tracker.nextTodo.title || ''}`
      : d.tracker.allDone ? '전부 done — 재개할 것이 없다' : '없음')
    if (d.tracker.doing?.evidence) kv2('근거', d.tracker.doing.evidence)
    if (d.tracker.nextAction) kv2('nextAction', d.tracker.nextAction)
    now.append(t2)
  }

  /* 사용량 표 */
  if (Object.keys(s.byModel || {}).length) {
    const tb = el('table', 'models')
    const thead = el('thead'), hr = el('tr')
    for (const h of ['모델', '입력', '캐시쓰기', '캐시읽기', '출력', '정가']) hr.append(el('th', null, h))
    thead.append(hr); tb.append(thead)
    const body = el('tbody')
    for (const [id, t] of Object.entries(s.byModel)) {
      const r = el('tr')
      r.append(el('td', null, id + (t.estimated ? ' (추정)' : '')),
        el('td', null, compact(t.input)), el('td', null, compact(t.cacheWrite1h + t.cacheWrite5m)),
        el('td', null, compact(t.cacheRead)), el('td', null, compact(t.output)),
        el('td', null, '$' + t.usd.toFixed(2)))
      body.append(r)
    }
    tb.append(body)
    now.append(el('div', 'note', '토큰은 트랜스크립트 실측이고 금액은 정가 환산이다. ' + (S.state.totals.costNote || '')))
    now.append(tb)
  }

  /* 재시작 예산 */
  if (d.restart) {
    const r = d.restart, c = r.config, b = r.budget
    const box = el('div')
    box.append(el('div', 'note', `재시작 예산 — 오늘 ${b.runsToday}/${c.maxPerDay}회 · $${b.costToday}/$${c.maxCostUSDPerDay ?? '-'} · 연속실패 ${r.state.failStreak || 0}/${c.failStreakMax} · 권한 ${c.permissionMode}`))
    const m = el('div', 'meter' + (b.runsToday >= c.maxPerDay ? ' crit' : b.runsToday / c.maxPerDay > .7 ? ' warn' : ''))
    const i = el('i'); i.style.width = Math.min(100, (b.runsToday / Math.max(1, c.maxPerDay)) * 100) + '%'
    m.append(i); box.append(m)
    if (!b.ok) box.append(el('div', 'note', `지금 재시작하지 않는 이유: ${b.why}`))
    if (r.state.lastRun) {
      const L = r.state.lastRun
      box.append(el('div', 'note', `마지막 실행 ${L.at} · ${L.result} · ${L.tookSec}초 · $${L.costUSD ?? 0} · 턴 ${L.turns ?? '?'}`))
      if (L.summary) box.append(el('div', 'warnbox', L.summary))
    }
    now.append(el('div', null, ' '), box)
  }

  /* 타임라인 */
  const tl = $('#tab-tl'); tl.textContent = ''
  for (const it of [...d.item].reverse()) {
    const cls = it.kind === '사용자' ? 'user' : it.kind === '어시스턴트' ? 'asst' : 'tool'
    const w = el('div', 'ti ' + cls)
    const hd = el('div', 'hd')
    hd.append(el('span', 'who', it.kind), el('span', null, it.at || ''))
    if (it.models) hd.append(el('span', null, it.models))
    if (it.hasThinking) hd.append(el('span', null, '· 사고'))
    if (it.sidechain) hd.append(el('span', null, '· 서브에이전트'))
    if (it.tokens) hd.append(el('span', 'tok', `· 출력 ${n(it.tokens.output)}${it.tokens.thinking ? ` (사고 ${n(it.tokens.thinking)})` : ''} · 캐시읽기 ${compact(it.tokens.cacheRead)}`))
    w.append(hd)
    if (it.label) w.append(el('div', 'body', it.label))
    if (it.result?.length) {
      for (const r of it.result) {
        const c = el('div', 'tchip')
        c.append(el('b', null, r.error ? '오류' : '결과'), el('span', null, r.digest || ''))
        w.append(c)
      }
    }
    if (it.tools?.length) {
      const box = el('div', 'tools')
      for (const t of it.tools) {
        const c = el('div', 'tchip'); c.append(el('b', null, t.name), el('span', null, t.digest || ''))
        box.append(c)
      }
      w.append(box)
    }
    tl.append(w)
  }
  if (!d.item.length) tl.append(el('div', 'empty', '최근 항목이 없다.'))

  /* 로그 */
  $('#tab-hb').textContent = (d.watchLog || []).join('\n') || '(감시 기록이 없다 — 감시를 켜고 5분 기다리거나 “지금 감시 실행”)'
  $('#tab-rs').textContent = (d.restartLog || []).join('\n') || '(재시작 기록이 없다)'

  /* 설정 */
  const cfg = $('#tab-cfg'); cfg.textContent = ''
  cfg.append(el('div', 'note', '재개지시 — 추적기가 없는 세션은 이 지시가 있어야 재시작한다. 비우면 “하던 일을 이어서”가 된다.'))
  const ta = el('textarea'); ta.value = d.target?.resumePrompt || ''
  ta.placeholder = '예: _plan/todo.md 의 첫 미완 항목을 하나만 끝내고 커밋하라.'
  cfg.append(ta)
  const save = el('button', 'sm primary', '재개지시 저장')
  save.addEventListener('click', async () => {
    save.disabled = true
    await actions.post('/api/targets', { sessionIds: [S.openSession], resumePrompt: ta.value, meta: actions.meta(s) })
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
  cfg.append(el('div', 'note', `대상 등록 ${d.target ? '됨' : '안 됨'} · 감시 ${d.target?.watch ? 'O' : 'X'} · 재시작 ${d.target?.restart ? 'O' : 'X'}`))

  drawTab()
}

function drawTab() {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === S.tab)
  for (const k of ['now', 'tl', 'hb', 'rs', 'cfg', 'al']) $('#tab-' + k).classList.toggle('hide', k !== S.tab)
  // 알림 탭에서는 세션 상세 묶음을 숨긴다 (알림은 그 바깥에 있다)
  if (S.openSession && S.detail) $('#dbody').classList.toggle('hide', S.tab === 'al')
}


export { redrawDetail }
