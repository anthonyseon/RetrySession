/**
 * app.js — 상태 화면. 의존성 없음.
 *
 * 갱신 방식
 *   목록·타일은 3초, 열려 있는 상세는 2초마다 다시 읽는다. SSE 가 아니라 폴링인 이유는
 *   이 도구가 "다른 것이 다 멈췄을 때 살아 있어야 하는" 감시 장치라서다 —
 *   연결이 끊겼다 붙는 상황에서 폴링이 더 단순하고 덜 고장난다.
 *   대신 마지막 성공 시각을 항상 화면에 적어, 화면이 멈춘 것을 사람이 알 수 있게 한다.
 *
 * 🔴 상태는 색만으로 나르지 않는다. 배지는 아이콘+라벨+색 세 벌을 함께 쓴다.
 */
'use strict'

const $ = (s) => document.querySelector(s)
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n }
const esc = (s) => String(s ?? '')
const n = (v) => (Number(v) || 0).toLocaleString('ko-KR')
const 압축 = (v) => {
  const x = Number(v) || 0
  if (Math.abs(x) >= 1e9) return (x / 1e9).toFixed(1) + 'B'
  if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(1) + 'M'
  if (Math.abs(x) >= 1e4) return (x / 1e3).toFixed(1) + 'K'
  return n(x)
}
const 짧은경로 = (p) => String(p || '').replace(/^.*[\\/]Cnthoth-Dev[\\/]/i, '…/').replace(/\\/g, '/')

const S = {
  상태: null, 상세: null, 선택: new Set(), 열린세션: null,
  탭: 'now', 자동: true, 마지막성공: 0, 오류: null, 등록만: false, 마지막상세키: null,
}

/* ── 배지 ────────────────────────────────────────────────────── */
function badge(kind, icon, label) {
  const b = el('span', 'badge ' + kind)
  b.append(el('i', 'ic', icon), el('span', null, label))
  return b
}
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

/* ── 스크롤 보존 ─────────────────────────────────────────────── */
/**
 * 🔴 목록은 3초, 상세는 2초마다 통째로 다시 그린다.
 *   그대로 두면 사용자가 스크롤할 때마다 맨 위로 튕겨 읽을 수가 없다.
 *   다시 그리기 전에 위치를 재고, 그린 뒤 되돌린다.
 *
 * 바닥에 붙어 있었으면 **바닥에 붙인 채로** 둔다 — 로그·타임라인은 새 줄이
 * 아래에 쌓이므로, 위치를 그대로 복원하면 새 내용이 화면 밖으로 밀려난다.
 */
const 바닥여유 = 24 // px. 스크롤바를 끝까지 내리지 않아도 "바닥"으로 본다

function 스크롤유지(sel, 다시그리기, { 맨위로 = false } = {}) {
  const box = $(sel)
  if (!box) { 다시그리기(); return }
  const 이전 = box.scrollTop
  const 바닥이었나 = box.scrollHeight - box.clientHeight - 이전 <= 바닥여유

  다시그리기()

  // 다른 세션·다른 탭으로 옮겼으면 이전 위치를 되돌리는 게 오히려 이상하다
  if (맨위로) { box.scrollTop = 0; return }

  // 레이아웃이 확정된 뒤에 되돌린다
  if (바닥이었나) box.scrollTop = box.scrollHeight
  else box.scrollTop = Math.min(이전, Math.max(0, box.scrollHeight - box.clientHeight))
}

/** 상세를 다시 그린다. 보고 있던 세션·탭이 바뀌었으면 맨 위에서 시작한다 */
function 상세다시그리기() {
  const 키 = `${S.열린세션 || ''}|${S.탭}`
  const 바뀜 = 키 !== S.마지막상세키
  S.마지막상세키 = 키
  스크롤유지('#dscroll', 상세그리기, { 맨위로: 바뀜 })
}

/* ── 경보 배너 ───────────────────────────────────────────────── */
/**
 * Windows 풍선 알림 대신 여기에 띄운다.
 *
 * 풍선은 상태가 조금만 오르내려도 떠서(서버 재시작 한 번에 두 번) 진짜 경고가
 * 묻혔다. 화면 맨 위 배너는 창을 열면 바로 보이고, 조치할 곳 바로 옆에 있다.
 * 이력은 "알림" 탭에서 본다 — 창을 닫아둔 사이의 변화는 하트비트가 적어둔다.
 */
const 경보아이콘 = { critical: '▲', warning: '▲', info: '●' }
const 경보라벨 = { critical: '치명', warning: '주의', info: '정보' }

function 경보그리기(d) {
  const box = $('#alerts'); box.textContent = ''
  const list = d.경보 || []
  if (!list.length) { box.classList.add('hide'); return }
  box.classList.remove('hide')

  for (const a of list) {
    const w = el('div', 'alert ' + a.수준)
    w.append(el('i', 'ic', 경보아이콘[a.수준] || '●'))
    const t = el('div', 'txt')
    t.append(el('div', 't', a.제목), el('div', 'd', a.설명))
    w.append(t, el('span', 'lv', 경보라벨[a.수준] || a.수준))
    // 세션에 딸린 경보면 눌러서 그 세션 상세로 간다 — 조치까지 한 번에
    if (a.대상) {
      w.style.cursor = 'pointer'
      w.title = '이 세션의 상세 보기'
      w.addEventListener('click', () => { S.열린세션 = a.대상; S.상세 = null; 그리기(); 상세읽기() })
    }
    box.append(w)
  }
}

/* ── 요약 묶음 ───────────────────────────────────────────────── */

/**
 * `2026-09-21 13:31:01` → 오늘이면 `13:31`, 다른 날이면 `09-21 13:31`.
 *
 * 🔴 왜 줄이나
 *   요약의 좁은 칸에서 전체 시각은 자리를 너무 먹는다 — OS 트리거 네 줄에 시각이
 *   여덟 개 들어가면 그것만으로 줄이 넘친다. 요약에서 궁금한 것은 "방금인가"이고,
 *   **다른 날이면 날짜를 남긴다** — 그 구별이 사라지면 오래된 기록을 방금으로 오해한다.
 *   초는 버린다. 5분 주기 작업에서 초는 판단을 바꾸지 않는다.
 */
function 짧은시각(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s ?? ''))
  if (!m) return s || '없음'
  const [, y, mo, d, hh, mi] = m
  const t = new Date()
  const 오늘 = Number(y) === t.getFullYear() && Number(mo) === t.getMonth() + 1 && Number(d) === t.getDate()
  return 오늘 ? `${hh}:${mi}` : `${mo}-${d} ${hh}:${mi}`
}
/**
 * 요약은 **묶음**으로 보여준다.
 *
 * 🔴 왜 카드를 버렸나
 *   열 항목을 똑같은 카드로 깔면, 낱장을 작게 줄여도 한눈에 안 들어온다 —
 *   계정 얘기와 OS 예약 얘기가 같은 무게로 나란히 있으면 어디를 볼지 알 수 없다.
 *   묶어서 이름을 붙이고, 값을 오른쪽에 모아 세로로 훑히게 한다.
 */
function 묶음(제목) {
  const g = el('div', 'grp')
  g.append(el('h3', null, 제목))
  return g
}

/**
 * 묶음 안의 한 항목. **두 줄**이다 — `이름 — 값` 그리고 그 아래 **보이는 세부**.
 *
 * 🔴 세부를 title(hover) 로만 남기지 마라.
 *   한 번 그렇게 했다가 "너무 심플하다"는 말을 들었고, 그 말이 맞다. 이 화면은
 *   무엇이 잘못됐는지 **판단하는** 자리다. 값만 던지고 근거를 감추면 판단할 수 없다.
 *   "해제됨"만 보이고 언제 기록된 것인지 안 보이면 지금 상태인지 알 수 없고,
 *   "6개"만 보이고 세션/보조 구분이 없으면 많은 건지 알 수 없다.
 *   세부는 화면에 있고, 세 줄을 넘치는 부분만 title 로 넘긴다.
 *
 * @param 값 문자열이거나 DOM 노드(배지 등)
 * @param 설명 값의 근거. 줄바꿈을 쓰면 그대로 보인다.
 */
function 줄(g, 이름, 값, 설명, 배지) {
  const r = el('div', 'grow')

  const top = el('div', 'gtop')
  top.append(el('span', 'k', 이름))
  const v = el('span', 'v')
  if (값 instanceof Node) v.append(값)
  else v.textContent = String(값)
  if (배지) { v.append(document.createTextNode(' ')); v.append(배지) }
  top.append(v)
  r.append(top)

  if (설명) r.append(el('div', 'gd', 설명))

  // 값이 좁은 칸에서 잘리거나 세부가 세 줄을 넘칠 때를 위한 보험
  const 값글 = 값 instanceof Node ? 값.textContent : 값
  r.title = 설명 ? `${이름} — ${값글}\n${설명}` : `${이름} — ${값글}`
  g.append(r)
  return r
}

/**
 * 요약 전체. 네 묶음으로 나눈다 — **같은 질문에 답하는 것끼리** 모은다.
 *
 *   계정      — 누구로 돌고 있나, 지금 제한에 걸렸나
 *   실행 중   — 무엇이 돌고 있나 (세션 · VS Code 창 · claude.exe)
 *   사용량    — 얼마나 썼나
 *   OS 트리거 — 세션 바깥에서 도는 네 작업이 살아 있나
 */
function 타일들(d) {
  const box = $('#tiles'); box.textContent = ''
  const a = d.계정, q = d.할당량, h = d.합계

  /* ── 계정 ── */
  const g1 = 묶음('계정')
  줄(g1, '계정', a.email || '확인 실패',
    a.ok ? `${a.subscriptionType || '?'} · ${a.authMethod || '?'} · ${a.orgName || ''}`
         : `로그인 안 됨 — ${a.오류 || ''}`,
    a.ok ? null : badge('crit', '▲', '로그인 안 됨'))
  // 할당량 — 기록 시점을 반드시 함께 보여준다. 지금 상태가 아닐 수 있다.
  줄(g1, '사용량 제한',
    !q.있음 ? '기록 없음' : (q.이미해제됨 ? '해제됨' : `${q.해제_남은분}분 후 해제`),
    !q.있음 ? q.설명
      : `${q.종류 || '?'} · ${q.status || '?'} · 기록 ${짧은시각(q.기록시각)}` +
        (q.해제시각 ? ` · 해제 ${짧은시각(q.해제시각)}` : '') +
        (q.초과불가이유 ? ` · 초과사용 불가(${q.초과불가이유})` : ''),
    q.있음 && !q.이미해제됨 ? badge('warn', '▲', '제한 중') : null)
  box.append(g1)

  /* ── 실행 중 ── */
  const g2 = 묶음('실행 중')
  // 조회가 실패했으면 "0 / 7" 이 아니라 "? / 7" 이다 — 0 은 "아무도 안 돈다"는 거짓말이다
  줄(g2, '세션', `${h.실행여부앎 === false ? '?' : h.실행중} / ${h.세션수}`,
    h.실행여부앎 === false
      ? `실행 여부를 확인할 수 없다 — ${h.실행여부오류 || ''} · 감시 ${h.감시켜짐} · 재시작 ${h.재시작켜짐}`
      : `실행 중 / 전체 · 감시 ${h.감시켜짐} · 재시작 ${h.재시작켜짐}`,
    h.실행여부앎 === false ? badge('crit', '▲', '조회 실패') : null)

  /**
   * VS Code 창 — 열린 창과 남은 흔적을 구별한다.
   *
   * 🔴 읽기에 실패했으면 "0개 열림"이 아니라 "?" 다. 0 은 "안 열려 있다"는 **주장**인데,
   *   실패했을 때 우리는 그걸 주장할 수 없다. 세션 줄에서 고친 것과 같은 부류다.
   *   (lock 폴더가 아예 없는 것은 실패가 아니라 진짜 0 이다 — ide.오류 로 가른다.)
   */
  const ide = d.ide || { 창: [], 살아있는창: 0, 낡은lock: 0, 폴더: [] }
  const t살아 = ide.창.filter((w) => w.살아있음)
  줄(g2, 'VS Code', ide.오류 ? '?' : `${ide.살아있는창}개 열림`,
    t살아.length
      ? t살아.map((w) => `포트 ${w.포트} · pid ${w.pid} · 폴더 ${w.workspaceFolders.length}개`).join('\n') +
        (ide.낡은lock ? `\n낡은 lock ${ide.낡은lock}개 (닫힌 창의 흔적)` : '')
      : (ide.오류 ? `읽기 실패: ${ide.오류}` : 'VS Code 연동 정보가 없다'),
    ide.오류 ? badge('warn', '▲', '읽기 실패')
      : (h.세션없는폴더 ? badge('off', '○', `세션 없는 폴더 ${h.세션없는폴더}`) : null))

  /**
   * 실행 중인 claude.exe — CLI 가 보고하든 안 하든 돌고 있는 것은 전부 센다.
   * 실측: CLI 가 세션 2개를 보고할 때 프로세스는 4개였다(둘은 MCP 보조).
   */
  // 🔴 여기도 마찬가지다 — 조회에 실패했으면 "0개"가 아니라 "?" 다
  const pr = d.프로세스 || { 목록: [], 세션수: 0, 보조수: 0, 짝없음: [] }
  줄(g2, 'claude 프로세스', pr.ok === false ? '?' : `${pr.목록.length}개`,
    pr.ok === false ? `조회 실패: ${pr.오류 || ''}`
      : `세션 ${pr.세션수} · 보조 ${pr.보조수}` +
        (pr.짝없음.length ? ` · 목록에 없는 프로세스 ${pr.짝없음.length}` : '') +
        (pr.목록[0]?.출처 ? ` · ${pr.목록[0].출처}${pr.목록[0].확장버전 ? ` ${pr.목록[0].확장버전}` : ''}` : ''),
    pr.ok === false ? badge('warn', '▲', '조회 실패')
      : (h.권한우회세션 ? badge('warn', '▲', `권한 우회 ${h.권한우회세션}`) : null))
  box.append(g2)

  /* ── 사용량 ── */
  const g3 = 묶음('사용량')
  줄(g3, '누적 토큰', 압축(h.총토큰), `${h.세션수}개 세션 합계`)
  줄(g3, '정가 환산', '$' + n(h.총USD.toFixed ? h.총USD.toFixed(2) : h.총USD), h.비용해석)
  box.append(g3)

  /* ── OS 트리거 ── */
  /**
   * 🔴 "등록 안 됨"과 "조회 실패"를 구별한다. 대처가 다르다(재등록 vs 권한·환경 확인).
   * 🔴 트레이도 넣는다 — 경보는 트레이를 말하는데 화면에 없으면 볼 곳이 없다
   *   (실측: "예약 작업이 실패로 끝났습니다 / 트레이 —" 경보를 받고 확인할 화면이 없었다).
   */
  const g4 = 묶음('OS 트리거')
  const 작업 = d.작업
  for (const [키, 라벨] of [
    ['하트비트', '감시'], ['재시작', '재시작'], ['UI', 'UI'], ['트레이', '트레이'],
  ]) {
    const w = 작업[키]
    if (!w) continue
    /**
     * 🔴 값은 배지 **하나만** 쓴다.
     *   상태 글자("Running")와 배지("● 도는 중")를 나란히 두면 같은 말을 두 번 하면서
     *   좁은 값 칸을 넘쳐 배지가 잘린다. 배지가 이미 아이콘+라벨을 함께 나르므로
     *   그것만으로 충분하다. 자세한 사정(결과뜻·마지막·다음 실행)은 title 에 남기고,
     *   정말 문제일 때는 접히지 않는 경보 배너가 전체 문장을 보여준다.
     */
    let 값, 설명
    if (w.조회실패) {
      값 = badge('warn', '▲', '조회 실패')
      설명 = `${w.이름} · ${w.오류 || ''}`
    } else if (!w.등록됨) {
      값 = badge('crit', '▲', '미등록')
      설명 = `${w.이름} · 등록되지 않았다 — scripts\\register-all.ps1`
    } else {
      // 강제 줄바꿈을 넣지 않는다 — 칸 폭에 맞춰 흐르게 두면 한 줄로 끝나는 경우가 많고,
      // 넣으면 항목마다 한 줄씩 더 먹어 묶음이 불필요하게 길어진다(실측: 12줄 -> 8줄)
      설명 = `${w.상태 || '?'} · ${w.결과뜻 || '?'} · 마지막 ${짧은시각(w.마지막실행)}` +
        (w.다음실행 ? ` · 다음 ${짧은시각(w.다음실행)}` : '')
      // 멈춘 것과 고장 난 것은 대처가 다르다 — 같은 빨강으로 말하지 않는다
      if (w.중지됨) 값 = badge('warn', '■', '멈춰 있음')
      else if (!w.정상) 값 = badge('crit', '▲', '실패')
      else 값 = badge('good', '●', w.돌고있음 ? '도는 중' : '대기')
    }
    줄(g4, 라벨, 값, 설명)
  }
  box.append(g4)

  요지갱신(d)
}

/**
 * 접었을 때 띠에 남는 한 줄 요지.
 *
 * 🔴 접었다고 아무것도 모르면 안 된다. 접는 이유는 자리를 비우려는 것이지
 *   상태를 포기하려는 것이 아니다. 가장 자주 보는 것만 한 줄로 남긴다.
 */
function 요지갱신(d) {
  const h = d.합계, 작업 = d.작업 || {}
  const 트리거 = ['하트비트', '재시작', 'UI', '트레이']
    .map((k) => 작업[k]).filter(Boolean)
  const 성한트리거 = 트리거.filter((w) => w.정상).length
  const 실행 = h.실행여부앎 === false ? '?' : h.실행중

  $('#sumdigest').textContent = [
    `세션 ${실행}/${h.세션수}`,
    `감시 ${h.감시켜짐}`,
    `재시작 ${h.재시작켜짐}`,
    `트리거 ${성한트리거}/${트리거.length}`,
    `$${n(h.총USD.toFixed ? h.총USD.toFixed(2) : h.총USD)}`,
    d.할당량?.있음 && !d.할당량.이미해제됨 ? '사용량 제한 중' : null,
  ].filter(Boolean).join('  ·  ')
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
    row.addEventListener('click', () => { S.열린세션 = s.sessionId; S.상세 = null; 그리기(); 상세읽기() })
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

/* ── 상세 ────────────────────────────────────────────────────── */
function 상세그리기() {
  const d = S.상세
  const s = S.상태?.세션.find((x) => x.sessionId === S.열린세션)

  // 알림 이력은 세션 선택과 무관하다 — 창을 열자마자 볼 수 있어야 한다
  const 이력 = S.상태?.경보이력 || []
  $('#tab-al').textContent = 이력.length
    ? 이력.join('\n')
    : '(기록된 경보 변화가 없습니다. 하트비트가 5분마다 확인하고, 상태가 바뀔 때만 여기에 남깁니다.)'

  if (!S.열린세션 || !d || !s) {
    $('#dbody').classList.add('hide')
    // 알림 탭은 세션 없이도 보여준다
    $('#dempty').classList.toggle('hide', S.탭 === 'al')
    $('#dtitle').textContent = S.탭 === 'al' ? '알림 이력' : '상세 — 왼쪽에서 세션을 고르세요'
    탭그리기()
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
  kv('실행 위치', 짧은경로(s.실행cwd))
  kv('주 작업 위치', 짧은경로(s.주작업cwd))
  if (s.cwd상위?.length > 1) kv('오간 위치', s.cwd상위.map((c) => `${짧은경로(c.경로)} (${n(c.엔트리)})`).join('\n'))
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
        el('td', null, 압축(t.입력)), el('td', null, 압축(t.캐시쓰기1h + t.캐시쓰기5m)),
        el('td', null, 압축(t.캐시읽기)), el('td', null, 압축(t.출력)),
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
      box.append(el('div', 'note', `마지막 실행 ${L.at} · ${L.결과} · ${L.소요초}초 · $${L.비용USD ?? 0} · 턴 ${L.턴수 ?? '?'}`))
      if (L.요약) box.append(el('div', 'warnbox', L.요약))
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
    if (it.토큰) hd.append(el('span', 'tok', `· 출력 ${n(it.토큰.출력)}${it.토큰.사고 ? ` (사고 ${n(it.토큰.사고)})` : ''} · 캐시읽기 ${압축(it.토큰.캐시읽기)}`))
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
    await 보내기('/api/targets', { sessionIds: [S.열린세션], 재개지시: ta.value, meta: 메타(s) })
    save.disabled = false; 상세읽기()
  })
  const row = el('div'); row.style.marginTop = '8px'; row.style.display = 'flex'; row.style.gap = '7px'
  row.append(save)
  const b1 = el('button', 'sm', '지금 감시 실행')
  b1.addEventListener('click', () => 보내기('/api/run', { kind: 'heartbeat' }).then(() => setTimeout(상세읽기, 2500)))
  const b2 = el('button', 'sm', '지금 재시작 실행')
  b2.addEventListener('click', () => {
    if (!confirm('이 세션을 지금 재시작합니다. 사람이 보지 않는 상태로 토큰을 쓰고 파일을 고칠 수 있습니다. 계속할까요?')) return
    보내기('/api/run', { kind: 'resume', sessionId: S.열린세션 }).then(() => setTimeout(상세읽기, 3000))
  })
  row.append(b1, b2)
  cfg.append(row)
  cfg.append(el('div', 'note', `대상 등록 ${d.대상 ? '됨' : '안 됨'} · 감시 ${d.대상?.감시 ? 'O' : 'X'} · 재시작 ${d.대상?.재시작 ? 'O' : 'X'}`))

  탭그리기()
}

function 탭그리기() {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === S.탭)
  for (const k of ['now', 'tl', 'hb', 'rs', 'cfg', 'al']) $('#tab-' + k).classList.toggle('hide', k !== S.탭)
  // 알림 탭에서는 세션 상세 묶음을 숨긴다 (알림은 그 바깥에 있다)
  if (S.열린세션 && S.상세) $('#dbody').classList.toggle('hide', S.탭 === 'al')
}

/* ── 통신 ────────────────────────────────────────────────────── */
async function 보내기(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) alert('실패: ' + (j.오류 || r.status))
  await 상태읽기()
  return j
}

const 메타 = (s) => ({
  제목: s.제목, 실행cwd: s.실행cwd, 주작업cwd: s.주작업cwd, slug: s.slug,
})

async function 상태읽기() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    S.상태 = await r.json(); S.마지막성공 = Date.now(); S.오류 = null
  } catch (e) { S.오류 = e.message }
  그리기()
}

async function 상세읽기() {
  if (!S.열린세션) return
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(S.열린세션)}?turns=60`, { cache: 'no-store' })
    if (r.ok) S.상세 = await r.json()
  } catch { /* 다음 회차에 다시 시도한다 */ }
  상세다시그리기()
}

function 그리기() {
  const d = S.상태
  신선도갱신()
  if (!d) return
  $('#acct').textContent = d.계정.email ? `${d.계정.email} · ${d.계정.subscriptionType || ''}` : '계정 확인 실패'
  경보그리기(d); 타일들(d); 폴더그리기(d)
  스크롤유지('#slist', () => { 목록(d); 선택갱신() })
  상세다시그리기()
}

/**
 * 🔴 신선도는 갱신과 **따로** 1초마다 고친다.
 *   화면 전체를 1초마다 다시 그리면 체크박스·스크롤이 튄다. 그리고 사람이 알아야 하는 것은
 *   "이 화면이 몇 초 전 것이냐"다 — 그 한 줄만 자주 고치면 멈춘 화면을 바로 알아챈다.
 */
function 신선도갱신() {
  const 초 = S.마지막성공 ? Math.round((Date.now() - S.마지막성공) / 1000) : null
  const dot = $('#dot')
  dot.className = 'dot' + (S.오류 ? ' off' : 초 === null ? ' off' : 초 > 12 ? ' stale' : '')
  if (S.오류) $('#freshness').textContent = `읽기 실패${초 !== null ? ` (${초}초 전 성공)` : ''} — ${S.오류}`
  else if (!S.상태) $('#freshness').textContent = '연결 중…'
  else $('#freshness').textContent = `${S.상태.at} · ${초}초 전 갱신 · 스캔 ${S.상태.스캔.ms}ms`
}

/* ── 사건 ────────────────────────────────────────────────────── */
document.querySelector('.actions').addEventListener('click', async (e) => {
  const act = e.target.dataset?.act
  if (!act || !S.선택.size) return
  const ids = [...S.선택]
  const meta = {}
  for (const id of ids) {
    const s = S.상태?.세션.find((x) => x.sessionId === id)
    if (s) meta[id] = 메타(s)
  }
  if (act === 'watch-on') await 보내기('/api/targets', { sessionIds: ids, 감시: true, meta })
  else if (act === 'watch-off') await 보내기('/api/targets', { sessionIds: ids, 감시: false, meta })
  else if (act === 'resume-on') {
    if (!confirm(`${ids.length}개 세션에 자율 재시작을 켭니다.\n\n사람이 보지 않는 상태에서 OS 예약이 claude --resume 을 띄워 토큰을 쓰고 파일을 고칠 수 있습니다. 가드(실행 중 확인·하루 횟수·비용 상한·연속실패 차단)는 걸려 있습니다.\n\n계속할까요?`)) return
    await 보내기('/api/targets', { sessionIds: ids, 재시작: true, meta })
  }
  else if (act === 'resume-off') await 보내기('/api/targets', { sessionIds: ids, 재시작: false, meta })
  else if (act === 'rearm') await 보내기('/api/rearm', { sessionIds: ids })
  else if (act === 'remove') {
    if (!confirm(`${ids.length}개 세션의 등록을 해제합니다. 감시·재시작이 모두 꺼집니다.`)) return
    await 보내기('/api/targets/remove', { sessionIds: ids })
    S.선택.clear()
  }
})

document.querySelector('#dtabs').addEventListener('click', (e) => {
  if (!e.target.dataset?.tab) return
  S.탭 = e.target.dataset.tab; 상세다시그리기()
})

$('#btnRefresh').addEventListener('click', () => { 상태읽기(); 상세읽기() })
$('#btnAuto').addEventListener('click', () => {
  S.자동 = !S.자동
  $('#btnAuto').textContent = S.자동 ? '자동갱신 켬' : '자동갱신 끔'
})
$('#btnTheme').addEventListener('click', () => {
  const 밝게 = document.documentElement.dataset.theme !== 'light'
  document.documentElement.dataset.theme = 밝게 ? 'light' : 'dark'
  $('#btnTheme').textContent = 밝게 ? '어둡게' : '밝게'
})

/* ── 요약 접기 ───────────────────────────────────────────────── */

/**
 * 요약 타일 묶음을 한 번에 접고 편다.
 *
 * 🔴 경보(.alerts-wrap)는 건드리지 않는다. 접힌 채로 '감시 끊김'이 숨으면
 *   이 도구가 막으려는 일이 정확히 일어난다.
 *
 * 화살표 모양만으로 말하지 않는다 — 옆에 '요약 접기/펴기'를 글자로 적고
 * aria-expanded 로도 알린다. 상태는 기억해 둔다(다시 열 때마다 접지 않아도 되게).
 */
const 접힘키 = 'rs.요약접힘'

function 요약적용(접힘, { 저장 = true } = {}) {
  $('#top').classList.toggle('hide', 접힘)
  $('#btnTop').setAttribute('aria-expanded', String(!접힘))
  $('#btnTopIc').textContent = 접힘 ? '▸' : '▾'
  $('#btnTopTx').textContent = 접힘 ? '요약 펴기' : '요약 접기'
  $('#btnTop').title = 접힘
    ? '요약을 펴면 계정·사용량·OS 트리거를 볼 수 있습니다'
    : '요약을 접으면 세션과 상세가 넓어집니다'
  if (저장) { try { localStorage.setItem(접힘키, 접힘 ? '1' : '0') } catch { /* 저장 못 해도 동작은 한다 */ } }
}

$('#btnTop').addEventListener('click', () => {
  요약적용($('#btnTop').getAttribute('aria-expanded') === 'true')
})

// 기억해 둔 상태로 시작한다
try { 요약적용(localStorage.getItem(접힘키) === '1', { 저장: false }) }
catch { 요약적용(false, { 저장: false }) }
$('#onlyReg').addEventListener('change', (e) => { S.등록만 = e.target.checked; 그리기() })

/* ── 시작 ────────────────────────────────────────────────────── */
상태읽기()
setInterval(() => { if (S.자동) 상태읽기() }, 3000)
setInterval(() => { if (S.자동 && S.열린세션) 상세읽기() }, 2000)
// 신선도만 1초마다 — 화면이 멈췄는지 사람이 바로 안다 (전체를 다시 그리지 않는다)
setInterval(신선도갱신, 1000)
