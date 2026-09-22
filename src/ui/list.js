/**
 * list.js — 열린 폴더와 세션 목록. 왼쪽 패널을 그린다.
 */
'use strict'
import { $, el, n, compact, shortPath, S, badge, actions } from './common.js'

/* ── 세션 배지 (목록 전용) ──────────────────────────────────── */
const watchBadge = (s) => {
  if (!s.감시.켜짐) return badge('off', '○', '감시 꺼짐')
  const v = s.감시.verdict
  if (!v) return badge('warn', '◔', '감시 켬 · 기록 대기')
  // 🔴 첫 기록을 기다리는 중은 끊긴 것이 아니다 — 빨강으로 말하지 않는다
  if (v.대기) return badge('warn', '◔', `감시 켬 · ${v.why}`)
  return v.alive
    ? badge('good', '●', `감시 정상 · ${v.ageMin}분 전`)
    : badge('crit', '▲', `감시 끊김 · ${v.why}`)
}
/** 제한에 잘려 멈춰 있나 — 재개가 이어받을 수 있는 상태다 */
const limitBadge = (s) => (s.제한으로멈춤
  ? badge('warn', '◔', '사용량 제한으로 중단됨' + (s.제한알림시각 ? ' · ' + s.제한알림시각 : ''))
  : null)

const resumeBadge = (s) => {
  const r = s.재시작
  if (!r.켜짐) return badge('off', '○', '재시작 꺼짐')
  if (r.차단) return badge('crit', '▲', '재시작 차단됨')
  if (r.손상) return badge('crit', '▲', '상태 파일 손상')
  if (!r.예산통과) return badge('warn', '◔', '재시작 대기 · ' + (r.예산이유 || ''))
  return badge('good', '●', '재시작 준비')
}


/* ── 열린 폴더 ───────────────────────────────────────────────── */
/**
 * VS Code 에 열린 폴더별 세션 수.
 *
 * 왜 필요한가 — "이 폴더의 세션이 목록에 없다"를 설명하는 유일한 방법이다.
 * 폴더가 열려 있어도 **그 폴더에서 Claude Code 를 시작한 적이 없으면** 세션이 없다.
 * 실측: Description 은 열려 있고 거기서 작업도 했지만, 세션은 EasyAI.Platform 에서
 * 시작해 옮겨온 것이라 `여기서시작` 이 0 이었다.
 */
function drawFolders(d) {
  const box = $('#folders'); box.textContent = ''
  const 폴더 = d.ide?.폴더 || []
  if (!폴더.length) { box.classList.add('hide'); return }
  box.classList.remove('hide')

  for (const f of 폴더) {
    const row = el('div', 'frow')
    const name = shortPath(f.폴더)
    row.append(el('span', 'fname', name))

    if (f.여기서시작 > 0) {
      row.append(badge('good', '●', `세션 ${f.여기서시작}`))
    } else if (f.세션수 > 0) {
      // 여기서 일하지만 여기서 시작하지 않았다 — 이게 Description 의 경우다
      row.append(badge('off', '⇄', `여기서 시작한 세션 없음 · 다른 곳에서 시작한 ${f.세션수}개가 작업 중`))
    } else {
      row.append(badge('off', '○', '세션 없음 — 이 폴더에서 Claude Code 를 시작한 적이 없다'))
    }
    if (f.실행중) row.append(badge('good', '▶', `실행 중 ${f.실행중}`))
    if (f.감시) row.append(badge('good', '◉', `감시 ${f.감시}`))
    box.append(row)
  }
}

/* ── 세션 목록 ───────────────────────────────────────────────── */
function 목록(d) {
  const box = $('#slist'); box.textContent = ''
  let list = d.세션
  if (S.onlyRegistered) list = list.filter((s) => s.등록됨)

  $('#scount').textContent = ''
  $('#scount').append(el('i', 'ic', '●'), el('span', null, `${list.length}개`))

  /**
   * 🔴 "없다"고만 하지 않고 **왜 없는지** 적는다.
   *
   *   실측 (2026-09-22, 사용자 보고 두 번): 목록 자리가 통째로 비어 있었다. 원인은
   *   요약이 던져 목록이 아예 안 그려진 것이었는데(서버는 세션 8개를 주고 있었다),
   *   화면만 보고는 "세션이 없다"와 "목록이 고장났다"를 구별할 수 없었다.
   *   빈 자리는 아무 말도 하지 않는다 — 감시 장치에서 가장 나쁜 상태다.
   *   그래서 여기서 받은 개수와 걸러낸 이유를 말한다. 아무 글자도 없으면
   *   그건 이 함수가 돌지 않았다는 뜻이고, 그 사실 자체가 단서가 된다.
   */
  if (!list.length) {
    const sum = d.세션.length
    const 왜 = sum === 0
      ? '세션을 하나도 찾지 못했습니다 — ~/.claude/projects 에 기록이 없습니다.'
      : S.onlyRegistered
        ? `세션 ${sum}개를 받았지만 등록된 것이 없습니다 — '등록된 것만'을 끄면 전부 보입니다.`
        : `세션 ${sum}개를 받았는데 화면에 남은 것이 없습니다 — 걸러내는 조건을 확인하세요.`
    box.append(el('div', 'empty', 왜))
    return
  }

  for (const s of list) {
    const row = el('div', 'srow' + (S.openSession === s.sessionId ? ' sel' : ''))
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = S.picked.has(s.sessionId)
    cb.addEventListener('click', (e) => {
      e.stopPropagation()
      if (cb.checked) S.picked.add(s.sessionId); else S.picked.delete(s.sessionId)
      syncSelection()
    })
    row.append(cb)

    const body = el('div')
    const t = el('div', 'stitle')
    // 🔴 "정지"와 "모름"을 구별한다. 조회가 실패했는데 정지라고 하면 거짓말이다.
    t.append(s.실행여부앎 === false
      ? badge('warn', '▲', '실행 여부 모름')
      : badge(s.실행중 ? 'good' : 'off', s.실행중 ? '▶' : '■', s.실행중 ? `실행 중 · pid ${s.pid}` : '정지'))
    t.append(el('span', null, s.제목 || '(제목 없음)'))
    if (s.여러저장소) t.append(badge('off', '⇄', '여러 위치'))
    body.append(t)

    const m = el('div', 'smeta')
    const add = (k, v) => { const w = el('span'); w.append(el('b', null, k + ' '), document.createTextNode(v)); m.append(w) }
    add('id', s.짧은id)
    add('활동', s.활성분 != null ? `${s.활성분}분 전` : '?')
    add('턴', `u${s.사용자메시지}/a${s.어시스턴트메시지}`)
    add('도구', n(s.도구호출))
    add('토큰', compact(s.토큰합))
    add('정가', '$' + (s.비용USD || 0).toFixed(2))
    if (s.gitBranch) add('브랜치', s.gitBranch)
    if (s.ide) add('VS Code', `포트 ${s.ide.포트}`)
    body.append(m)
    body.append(el('div', 'path', shortPath(s.주작업cwd || s.실행cwd)))

    const bb = el('div', 'sbadges')
    bb.append(watchBadge(s), resumeBadge(s))
    const limitInfo = limitBadge(s); if (limitInfo) bb.append(limitInfo)
    if (s.추적기.있음) {
      bb.append(badge(s.추적기.전부완료 ? 'good' : 'off', '▤',
        `추적기 ${s.추적기.완료표기}${s.추적기.doing ? ` · doing ${s.추적기.doing.id}` : ''}`))
    }
    if (s.추적기.doing위반) bb.append(badge('warn', '▲', `doing ${s.추적기.doing위반.length}개`))
    // 프로세스에서만 알 수 있는 것 — 사람이 알아야 하는 쪽부터
    if (s.프로세스?.위험권한) bb.append(badge('warn', '▲', '권한 우회로 실행 중'))
    if (s.프로세스?.addDirs?.length) {
      bb.append(badge('off', '+', `추가 폴더 ${s.프로세스.addDirs.map((x) => x.split('/').pop()).join(', ')}`))
    }
    body.append(bb)

    row.append(body)
    row.addEventListener('click', () => { S.openSession = s.sessionId; S.detail = null; actions.draw(); actions.loadDetail() })
    box.append(row)
  }

  /**
   * 🔴 세션 행에 짝지어지지 않은 claude.exe 를 목록 끝에 그대로 보여준다.
   *
   * "왜 목록에 없나"는 물음이 반복해서 나왔다. 답이 "세션이 아니라서"든
   * "CLI 가 아직 모르는 세션이라서"든, **돌고 있는 것이 화면에 하나도 안 보이는 상태**가
   * 그 물음을 만든다. 정체를 몰라도 있다는 사실은 보여준다.
   */
  const 짝없음 = d.프로세스?.짝없음 || []
  if (짝없음.length) {
    const hdr = el('div', 'orphan-hd')
    hdr.append(el('span', null, '세션 행에 짝지어지지 않은 claude 프로세스'),
      badge('off', '?', `${짝없음.length}개`))
    box.append(hdr)

    for (const p of 짝없음) {
      const r = el('div', 'orow')
      const t = el('div', 'stitle')
      t.append(badge(p.종류 === '세션' ? 'warn' : 'off', p.종류 === '세션' ? '▲' : '⚙',
        p.종류 === 'mcp보조' ? '보조 프로세스 (세션 아님)'
          : p.종류 === '세션' ? '세션인데 CLI 가 보고하지 않음'
          : '용도 미상'))
      t.append(el('span', null, `pid ${p.pid}`))
      r.append(t)

      const m = el('div', 'smeta')
      const add = (k, v) => { const w = el('span'); w.append(el('b', null, k + ' '), document.createTextNode(v)); m.append(w) }
      add('시작', p.시작 || '?')
      add('출처', p.출처 + (p.확장버전 ? ` ${p.확장버전}` : ''))
      if (p.sessionId) add('세션', p.sessionId.slice(0, 8))
      if (p.권한모드) add('권한', p.권한모드)
      r.append(m)
      if (p.addDirs?.length) r.append(el('div', 'path', p.addDirs.map(shortPath).join('  ')))
      box.append(r)
    }
  }
}

function syncSelection() {
  $('#selN').textContent = `${S.picked.size}개 선택`
  document.querySelectorAll('.actions button').forEach((b) => { b.disabled = S.picked.size === 0 })
}


export { drawFolders, 목록, syncSelection }
