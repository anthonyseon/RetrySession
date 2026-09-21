/**
 * list.js — 열린 폴더와 세션 목록. 왼쪽 패널을 그린다.
 */
'use strict'
import { $, el, n, 압축, 짧은경로, S, badge, 동작 } from './common.js'

/* ── 세션 배지 (목록 전용) ──────────────────────────────────── */
const 감시배지 = (s) => {
  if (!s.감시.켜짐) return badge('off', '○', '감시 꺼짐')
  const v = s.감시.판정
  if (!v) return badge('warn', '◔', '감시 켬 · 기록 대기')
  return v.alive
    ? badge('good', '●', `감시 정상 · ${v.ageMin}분 전`)
    : badge('crit', '▲', `감시 끊김 · ${v.why}`)
}
const 재시작배지 = (s) => {
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
function 폴더그리기(d) {
  const box = $('#folders'); box.textContent = ''
  const 폴더 = d.ide?.폴더 || []
  if (!폴더.length) { box.classList.add('hide'); return }
  box.classList.remove('hide')

  for (const f of 폴더) {
    const row = el('div', 'frow')
    const name = 짧은경로(f.폴더)
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
  if (S.등록만) list = list.filter((s) => s.등록됨)

  $('#scount').textContent = ''
  $('#scount').append(el('i', 'ic', '●'), el('span', null, `${list.length}개`))

  if (!list.length) { box.append(el('div', 'empty', '보여줄 세션이 없다.')); return }

  for (const s of list) {
    const row = el('div', 'srow' + (S.열린세션 === s.sessionId ? ' sel' : ''))
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = S.선택.has(s.sessionId)
    cb.addEventListener('click', (e) => {
      e.stopPropagation()
      if (cb.checked) S.선택.add(s.sessionId); else S.선택.delete(s.sessionId)
      선택갱신()
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
    add('토큰', 압축(s.토큰합))
    add('정가', '$' + (s.비용USD || 0).toFixed(2))
    if (s.gitBranch) add('브랜치', s.gitBranch)
    if (s.ide) add('VS Code', `포트 ${s.ide.포트}`)
    body.append(m)
    body.append(el('div', 'path', 짧은경로(s.주작업cwd || s.실행cwd)))

    const bb = el('div', 'sbadges')
    bb.append(감시배지(s), 재시작배지(s))
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
    row.addEventListener('click', () => { S.열린세션 = s.sessionId; S.상세 = null; 동작.그리기(); 동작.상세읽기() })
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
      if (p.addDirs?.length) r.append(el('div', 'path', p.addDirs.map(짧은경로).join('  ')))
      box.append(r)
    }
  }
}

function 선택갱신() {
  $('#selN').textContent = `${S.선택.size}개 선택`
  document.querySelectorAll('.actions button').forEach((b) => { b.disabled = S.선택.size === 0 })
}


export { 폴더그리기, 목록, 선택갱신 }
