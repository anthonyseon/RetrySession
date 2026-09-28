/**
 * list.js — 열린 폴더와 세션 목록. 왼쪽 패널을 그린다.
 */
'use strict'
import { $, el, n, compact, shortPath, S, badge, actions } from './common.js'

/* ── 세션 배지 (목록 전용) ──────────────────────────────────── */
/**
 * 🔴 배지는 **두 가지를 함께** 말한다: 스위치가 켜졌나(설정) · 지금 어떤가(상태).
 *
 *   실측 (2026-09-22, 사용자 보고): [재시작 시작] 을 눌렀는데 "적용이 안 된 것 같다"고
 *   했다. 등록부에는 **8초 전에 제대로 써졌는데** 배지가 `⊘ 재개 안 함 · 세션이 실행
 *   중이다` 로 바뀌어서, 누른 것이 먹혔는지 알 수 없었다. `재시작 꺼짐` 과
 *   `재개 안 함` 은 **다른 축의 말**인데 같은 자리에 번갈아 나오니 구별이 안 된다.
 *
 *   그래서 켬/꺼짐을 **항상 앞에** 둔다. 누르면 `꺼짐` → `켬` 이 눈에 보이고,
 *   그 뒤의 말이 "그래서 지금은 어떤가"다. 설정과 상태를 한 배지에 뭉개지 않는다.
 */
const watchBadge = (s) => {
  if (!s.watch.on) return badge('off', '○', '감시 꺼짐')
  const v = s.watch.verdict
  if (!v) return badge('warn', '◔', '감시 켬 · 대기', '감시를 켰고 첫 기록을 기다리는 중입니다.')
  // 🔴 첫 기록을 기다리는 중은 끊긴 것이 아니다 — 빨강으로 말하지 않는다
  if (v.waiting) return badge('warn', '◔', '감시 켬 · 대기', v.why)
  return v.alive
    ? badge('good', '●', `감시 켬 · 정상 (${v.ageMin}분)`, `${v.ageMin}분 전에 기록했습니다.`)
    : badge('crit', '▲', '감시 켬 · 끊김', v.why)
}
/** 제한에 잘려 멈춰 있나 — 재개가 이어받을 수 있는 상태다 */
const limitBadge = (s) => (s.stoppedByLimit
  ? badge('warn', '◔', '제한 중단',
    `사용량 제한에 걸려 중단됐습니다${s.limitNoticeTime ? ` (${s.limitNoticeTime})` : ''}. 풀리면 재개가 이어받습니다.`)
  : null)

/**
 * 응답이 끝까지 오지 못하고 끊긴 자리 (절전·연결 끊김).
 * 사람이 "왜 여기서 멈췄지"를 묻는 바로 그 상태다 — 말해주지 않으면 원인을 못 찾는다.
 */
const interruptBadge = (s) => (s.stoppedByInterrupt
  ? badge('warn', '◔', '응답 끊김',
    `응답이 끝까지 오지 못했습니다${s.interruptNoticeTime ? ` (${s.interruptNoticeTime})` : ''} — 절전이나 연결 문제입니다.`)
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
/**
 * 막는 자리 → **한 단어.** 문장은 상세의 판정 패널이 맡는다.
 *
 * 🔴 왜 단어인가 — 목록은 세션 열세 줄을 **훑는** 자리다. 배지에 문장을 넣으면
 *   (`지금은 대기 — 세션이 실행 중이다 (pid 26184) — 사람이 쓰는 중이므로…`)
 *   한 줄이 배지 하나로 가득 차고, 옆의 다른 배지가 밀려나 안 읽힌다.
 *   단어는 훑히고, 문장은 눌러서 읽는다.
 */
const GATE_WORD = {
  running: '실행중', active: '활동중', limited: '사용량제한', quiet: '조용시간',
  budget: '상한도달', point: '지시없음', tracker: '할일없음', repo: '저장소잠금',
  gone: '세션없음', blocked: '연속실패', repeated: '반복끊김', off: '꺼짐',
}

const resumeBadge = (s) => {
  const r = s.restart
  // 🔴 꺼짐/켬이 **먼저** 온다 — 누른 것이 먹혔는지가 이 배지의 첫 임무다
  if (!r.on) return badge('off', '○', '재시작 꺼짐')
  if (r.corrupt) return badge('crit', '▲', '재시작 켬 · 상태손상', r.corrupt)
  const g = r.gate
  if (!g) return badge('warn', '◔', '재시작 켬 · 판정불가', '저장소를 찾지 못해 판정할 수 없습니다.')
  if (g.go) return badge('good', '●', `재시작 켬 · 가능 (${g.point})`, g.why)
  // 차단은 사람이 풀어야 한다 — 기다리면 되는 것들과 아이콘을 달리한다
  const crit = g.stage === 'blocked' || g.stage === 'repeated'
  const word = GATE_WORD[g.stage] || '대기'
  return badge(crit ? 'crit' : 'warn', crit ? '▲' : '◔',
    crit ? `재시작 켬 · 차단 (${word})` : `재시작 켬 · 대기 (${word})`, g.why)
}

/** 오늘 과부하로 막힌 횟수 — 차단하지 않으므로 여기서라도 보여야 한다 */
const overloadBadge = (s) => {
  const nth = s.restart?.overloadToday || 0
  return nth
    ? badge(nth >= 3 ? 'warn' : 'off', '⇅', `과부하 ${nth}회`,
      `오늘 API 과부하(529·5xx)로 ${nth}회 막혔습니다. 저쪽 문제라 연속실패로 세지 않습니다.`)
    : null
}

/**
 * 오늘 로그인이 끊겨 재개가 헛돈 횟수.
 *
 * 🔴 과부하와 달리 **한 번부터** 보여준다 — 저쪽이 흔들린 것이 아니라 우리 쪽
 *   전제(로그인된 계정)가 사라진 것이고, 사람이 다시 로그인해야 할 수도 있다.
 */
const authBadge = (s) => {
  const nth = s.restart?.authToday || 0
  return nth
    ? badge('warn', '⚿', `로그인끊김 ${nth}회`,
      `오늘 로그인이 끊겨 재개가 ${nth}회 헛돌았습니다. 연속실패로 세지 않으니 로그인이 살아나면 저절로 다시 돕니다.`)
    : null
}


/**
 * 사용량을 **오늘(로컬)과 누적으로 갈라** 두 줄로 보여준다.
 *
 * 🔴 왜 한 줄에 `330M / 1.8G` 로 붙이지 않았나 — 목록은 열세 줄을 훑는 자리다.
 *   슬래시로 붙이면 어느 쪽이 오늘인지 **기억해야** 읽히고, 네 항목이 모두 그 모양이면
 *   한 줄이 숫자 벽이 된다. 줄을 가르고 앞에 `오늘`·`누적` 을 붙이면 읽는 순간 갈린다.
 *
 * 🔴 누적만 보면 "지금 얼마나 쓰고 있나"를 알 수 없고, 오늘만 보면 이 세션이 얼마짜리인지
 *   알 수 없다. 둘 다 필요하므로 둘 다 적는다 — 하나를 고르는 문제가 아니다.
 */
function usageLines(s, add) {
  const box = el('div', 'usage')
  const row = (label, hint, u) => {
    const line = el('div', 'smeta uline')
    const tag = el('b', 'utag', label)
    if (hint) tag.title = hint
    line.append(tag)
    add(line, '턴', `u${n(u.user)}/a${n(u.asst)}`)
    add(line, '도구', n(u.tools))
    add(line, '토큰', compact(u.tokens))
    add(line, '정가', '$' + (u.usd || 0).toFixed(2))
    box.append(line)
  }
  row('오늘', s.todayKey ? `${s.todayKey} (로컬 시간 기준 · 자정에 0 으로 돌아간다)` : null, {
    user: s.todayUserMsgs || 0, asst: s.todayAssistantMsgs || 0,
    tools: s.todayToolCalls || 0, tokens: s.todayTokenSum || 0, usd: s.todayCostUSD || 0,
  })
  row('누적', '이 세션이 시작된 뒤 전체', {
    user: s.userMsgs, asst: s.assistantMsgs,
    tools: s.toolCalls, tokens: s.tokenSum, usd: s.costUSD,
  })
  return box
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
    const add = (box, k, v) => { const w = el('span'); w.append(el('b', null, k + ' '), document.createTextNode(v)); box.append(w) }
    add(m, 'id', s.shortId)
    add(m, '활동', s.activeMin != null ? `${s.activeMin}분 전` : '?')
    if (s.gitBranch) add(m, '브랜치', s.gitBranch)
    if (s.ide) add(m, 'VS Code', `포트 ${s.ide.port}`)
    body.append(m)
    body.append(usageLines(s, add))
    
    body.append(el('div', 'path', shortPath(s.mainCwd || s.runCwd)))

    const bb = el('div', 'sbadges')
    bb.append(watchBadge(s), resumeBadge(s))
    for (const b of [limitBadge(s), interruptBadge(s), overloadBadge(s), authBadge(s)]) if (b) bb.append(b)
    if (s.tracker.exists) {
      bb.append(badge(s.tracker.allDone ? 'good' : 'off', '▤',
        `추적기 ${s.tracker.doneMark}${s.tracker.doing ? ` · doing ${s.tracker.doing.id}` : ''}`))
    }
    if (s.tracker.doingViolations) bb.append(badge('warn', '▲', `doing ${s.tracker.doingViolations.length}개`))
    // 프로세스에서만 알 수 있는 것 — 사람이 알아야 하는 쪽부터
    // 🔴 이것도 단어로 — 설정 배지와 같은 줄에 있어서 길면 설정 상태를 밀어낸다.
    //   다만 **경고 아이콘은 지키다** — 권한 우회는 사람이 알아야 하는 사실이다.
    if (s.processes?.riskyPerm) {
      bb.append(badge('warn', '▲', '권한우회', '권한 확인을 우회하는 모드로 실행 중입니다 (bypassPermissions).'))
    }
    if (s.processes?.addDirs?.length) {
      const names = s.processes.addDirs.map((x) => x.split('/').pop())
      bb.append(badge('off', '+', `폴더 ${names.length}`, `--add-dir 로 붙은 폴더: ${names.join(', ')}`))
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
