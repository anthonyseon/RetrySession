/**
 * list.js — 열린 폴더와 세션 목록. 왼쪽 패널을 그린다.
 */
'use strict'
import { $, el, n, compact, shortPath, S, badge, actions } from './common.js'

/* ── 세션 배지 (목록 전용) ──────────────────────────────────── */
const watchBadge = (s) => {
  if (!s.watch.on) return badge('off', '○', '감시 꺼짐')
  const v = s.watch.verdict
  if (!v) return badge('warn', '◔', '감시 켬 · 기록 대기')
  // 🔴 첫 기록을 기다리는 중은 끊긴 것이 아니다 — 빨강으로 말하지 않는다
  if (v.waiting) return badge('warn', '◔', `감시 켬 · ${v.why}`)
  return v.alive
    ? badge('good', '●', `감시 정상 · ${v.ageMin}분 전`)
    : badge('crit', '▲', `감시 끊김 · ${v.why}`)
}
/** 제한에 잘려 멈춰 있나 — 재개가 이어받을 수 있는 상태다 */
const limitBadge = (s) => (s.stoppedByLimit
  ? badge('warn', '◔', '사용량 제한으로 중단됨' + (s.limitNoticeTime ? ' · ' + s.limitNoticeTime : ''))
  : null)

/**
 * 응답이 끝까지 오지 못하고 끊긴 자리 (절전·연결 끊김).
 * 사람이 "왜 여기서 멈췄지"를 묻는 바로 그 상태다 — 말해주지 않으면 원인을 못 찾는다.
 */
const interruptBadge = (s) => (s.stoppedByInterrupt
  ? badge('warn', '◔', '응답이 끊김' + (s.interruptNoticeTime ? ' · ' + s.interruptNoticeTime : ''))
  : null)

/**
 * 🔴 **재개가 내릴 판정을 그대로** 보여준다.
 *
 *   실측 결함 (2026-09-22): 여기서 예산만 보고 "재시작 준비"라고 말했다. 실제로는
 *   여덟 가지가 더 막는다 — 실행 중 · 재개 지점 없음 · 저장소 잠금 · 조용한 시간 …
 *   그래서 사람은 "준비"를 보고 자리를 비웠는데 15분마다 조용히 건너뛰었다.
 *   **없는 것을 있다고 말하는 것은 있는 것을 없다고 하는 것만큼 나쁘다.**
 *   판정은 lib/resume-gate.mjs 하나이고 재개도 같은 것을 쓴다.
 */
const resumeBadge = (s) => {
  const r = s.restart
  if (!r.on) return badge('off', '○', '재시작 꺼짐')
  if (r.corrupt) return badge('crit', '▲', '상태 파일 손상')
  const g = r.gate
  if (!g) return badge('warn', '◔', '재시작 켬 · 판정할 수 없다 (저장소를 못 찾았다)')
  if (g.go) return badge('good', '●', `재개 가능 · ${g.point}`)
  // 차단은 사람이 풀어야 한다 — 기다리면 되는 것들과 색을 달리한다
  const crit = g.stage === 'blocked' || g.stage === 'repeated'
  return badge(crit ? 'crit' : 'off', crit ? '▲' : '⊘', `재개 안 함 · ${g.why}`)
}

/** 오늘 과부하로 막힌 횟수 — 차단하지 않으므로 여기서라도 보여야 한다 */
const overloadBadge = (s) => {
  const nth = s.restart?.overloadToday || 0
  return nth ? badge(nth >= 3 ? 'warn' : 'off', '⇅', `API 과부하로 막힘 · 오늘 ${nth}회`) : null
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
/**
 * 열린 폴더 묶음도 **접힌다.**
 *
 * 🔴 왜 — 이 블록은 세션 목록 **위에** 있어서 폴더가 많으면 목록을 아래로 밀어낸다.
 *   "왜 내 세션이 안 보이나"를 한 번 확인한 뒤에는 계속 펼쳐 둘 이유가 없다.
 *   접어도 **머리줄에 요지가 남는다**(폴더 N · 세션 없는 폴더 N) — 접힌 것이
 *   "없는 것"으로 보이면 접기가 정보를 지우는 셈이 된다.
 */
const FOLD_FOLDERS = 'rs.foldFolders'
const foldersFolded = () => { try { return localStorage.getItem(FOLD_FOLDERS) === '1' } catch { return false } }

function drawFolders(d) {
  const box = $('#folders'); box.textContent = ''
  const folders = d.ide?.folders || []
  if (!folders.length) { box.classList.add('hide'); return }
  box.classList.remove('hide')

  const folded = foldersFolded()
  box.classList.toggle('folded', folded)
  const none = folders.filter((f) => !f.sessionCount).length
  const head = el('div', 'fhead')
  head.setAttribute('role', 'button')
  head.setAttribute('tabindex', '0')
  head.setAttribute('aria-expanded', folded ? 'false' : 'true')
  head.title = folded ? '열린 폴더 펼치기' : '열린 폴더 접기'
  head.append(el('span', 'fname', `열린 폴더 ${folders.length}개`))
  if (none) head.append(badge('off', '○', `세션 없는 폴더 ${none}`))
  const toggle = () => {
    try { localStorage.setItem(FOLD_FOLDERS, folded ? '0' : '1') } catch { /* 저장 못 해도 동작은 한다 */ }
    drawFolders(d)
  }
  head.addEventListener('click', toggle)
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } })
  box.append(head)
  if (folded) return

  for (const f of folders) {
    const row = el('div', 'frow')
    const name = shortPath(f.folders)
    row.append(el('span', 'fname', name))

    if (f.startedHere > 0) {
      row.append(badge('good', '●', `세션 ${f.startedHere}`))
    } else if (f.sessionCount > 0) {
      // 여기서 일하지만 여기서 시작하지 않았다 — 이게 Description 의 경우다
      row.append(badge('off', '⇄', `여기서 시작한 세션 없음 · 다른 곳에서 시작한 ${f.sessionCount}개가 작업 중`))
    } else {
      row.append(badge('off', '○', '세션 없음 — 이 폴더에서 Claude Code 를 시작한 적이 없다'))
    }
    if (f.running) row.append(badge('good', '▶', `실행 중 ${f.running}`))
    if (f.watch) row.append(badge('good', '◉', `감시 ${f.watch}`))
    box.append(row)
  }
}

/* ── 세션 목록 ───────────────────────────────────────────────── */
function items(d) {
  const box = $('#slist'); box.textContent = ''
  let list = d.sessions
  if (S.onlyRegistered) list = list.filter((s) => s.registered)

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
    const sum = d.sessions.length
    const why = sum === 0
      ? '세션을 하나도 찾지 못했습니다 — ~/.claude/projects 에 기록이 없습니다.'
      : S.onlyRegistered
        ? `세션 ${sum}개를 받았지만 등록된 것이 없습니다 — '등록된 것만'을 끄면 전부 보입니다.`
        : `세션 ${sum}개를 받았는데 화면에 남은 것이 없습니다 — 걸러내는 조건을 확인하세요.`
    box.append(el('div', 'empty', why))
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
    t.append(s.runKnown === false
      ? badge('warn', '▲', '실행 여부 모름')
      : badge(s.running ? 'good' : 'off', s.running ? '▶' : '■', s.running ? `실행 중 · pid ${s.pid}` : '정지'))
    t.append(el('span', null, s.title || '(제목 없음)'))
    if (s.multiRepo) t.append(badge('off', '⇄', '여러 위치'))
    body.append(t)

    const m = el('div', 'smeta')
    const add = (k, v) => { const w = el('span'); w.append(el('b', null, k + ' '), document.createTextNode(v)); m.append(w) }
    add('id', s.shortId)
    add('활동', s.activeMin != null ? `${s.activeMin}분 전` : '?')
    add('턴', `u${s.userMsgs}/a${s.assistantMsgs}`)
    add('도구', n(s.toolCalls))
    add('토큰', compact(s.tokenSum))
    add('정가', '$' + (s.costUSD || 0).toFixed(2))
    if (s.gitBranch) add('브랜치', s.gitBranch)
    if (s.ide) add('VS Code', `포트 ${s.ide.port}`)
    body.append(m)
    body.append(el('div', 'path', shortPath(s.mainCwd || s.runCwd)))

    const bb = el('div', 'sbadges')
    bb.append(watchBadge(s), resumeBadge(s))
    for (const b of [limitBadge(s), interruptBadge(s), overloadBadge(s)]) if (b) bb.append(b)
    if (s.tracker.exists) {
      bb.append(badge(s.tracker.allDone ? 'good' : 'off', '▤',
        `추적기 ${s.tracker.doneMark}${s.tracker.doing ? ` · doing ${s.tracker.doing.id}` : ''}`))
    }
    if (s.tracker.doingViolations) bb.append(badge('warn', '▲', `doing ${s.tracker.doingViolations.length}개`))
    // 프로세스에서만 알 수 있는 것 — 사람이 알아야 하는 쪽부터
    if (s.processes?.riskyPerm) bb.append(badge('warn', '▲', '권한 우회로 실행 중'))
    if (s.processes?.addDirs?.length) {
      bb.append(badge('off', '+', `추가 폴더 ${s.processes.addDirs.map((x) => x.split('/').pop()).join(', ')}`))
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
  const orphans = d.processes?.orphans || []
  if (orphans.length) {
    const hdr = el('div', 'orphan-hd')
    hdr.append(el('span', null, '세션 행에 짝지어지지 않은 claude 프로세스'),
      badge('off', '?', `${orphans.length}개`))
    box.append(hdr)

    for (const p of orphans) {
      const r = el('div', 'orow')
      const t = el('div', 'stitle')
      t.append(badge(p.kind === '세션' ? 'warn' : 'off', p.kind === '세션' ? '▲' : '⚙',
        p.kind === 'mcp보조' ? '보조 프로세스 (세션 아님)'
          : p.kind === '세션' ? '세션인데 CLI 가 보고하지 않음'
          : '용도 미상'))
      t.append(el('span', null, `pid ${p.pid}`))
      r.append(t)

      const m = el('div', 'smeta')
      const add = (k, v) => { const w = el('span'); w.append(el('b', null, k + ' '), document.createTextNode(v)); m.append(w) }
      add('시작', p.startedText || '?')
      add('출처', p.source + (p.extVersion ? ` ${p.extVersion}` : ''))
      if (p.sessionId) add('세션', p.sessionId.slice(0, 8))
      if (p.permissionMode) add('권한', p.permissionMode)
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


export { drawFolders, items, syncSelection }
