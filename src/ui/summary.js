/**
 * summary.js — 경보 배너와 요약 묶음. 화면 위쪽을 그린다.
 *
 * 🔴 경보는 접히지 않는다(index.html 의 .alerts-wrap). 요약만 접힌다.
 */
'use strict'
import { $, el, n, compact, S, badge, 동작 } from './common.js'

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

function drawAlerts(d) {
  const box = $('#alerts'); box.textContent = ''
  const list = [...(d?.경보 || [])]

  /**
   * 🔴 상태를 못 읽은 것 자체가 가장 급한 경보다.
   *   서버가 오류로 답하면 `d` 는 낡은 것이거나 없다 — 그 말은 화면의 나머지 전부가
   *   낡았다는 뜻이다. 머리말 구석의 작은 글씨로는 그 사실이 전달되지 않고,
   *   긴 이유는 거기서 잘린다. 배너는 전폭이고 조치를 적는 자리다.
   */
  if (S.오류) {
    list.unshift({
      코드: '상태읽기실패', 수준: 'critical',
      제목: '상태를 읽을 수 없습니다',
      설명: `${S.오류} — 아래 내용은 마지막으로 성공한 시점의 것입니다.`,
    })
  }

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
      w.addEventListener('click', () => { S.열린세션 = a.대상; S.상세 = null; 동작.draw(); 동작.loadDetail() })
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
function shortTime(s) {
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
function drawTiles(d) {
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
      : `${q.종류 || '?'} · ${q.status || '?'} · 기록 ${shortTime(q.기록시각)}` +
        (q.해제시각 ? ` · 해제 ${shortTime(q.해제시각)}` : '') +
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
  줄(g3, '누적 토큰', compact(h.총토큰), `${h.세션수}개 세션 합계`)
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
      설명 = `${w.상태 || '?'} · ${w.resultText || '?'} · 마지막 ${shortTime(w.마지막실행)}` +
        (w.다음실행 ? ` · 다음 ${shortTime(w.다음실행)}` : '')
      // 멈춘 것과 고장 난 것은 대처가 다르다 — 같은 빨강으로 말하지 않는다
      if (w.중지됨) 값 = badge('warn', '■', '멈춰 있음')
      else if (!w.정상) 값 = badge('crit', '▲', '실패')
      else 값 = badge('good', '●', w.돌고있음 ? '도는 중' : '대기')
    }
    줄(g4, 라벨, 값, 설명)
  }
  box.append(g4)

  /* ── PC 설정 ── */
  /**
   * 🔴 잠든 PC 는 아무것도 돌리지 않는다. 지금 초록이어도 사람이 자리를 비우는
   *   순간 멎을 수 있다 — 그래서 상태가 아니라 **조건**으로 따로 보여준다.
   *   읽기가 느려서(474ms 실측) 서버가 60초 캐시한다.
   */
  const pc = d.pc
  if (pc && Array.isArray(pc.목록)) {
    const g5 = 묶음('PC 설정')
    for (const x of pc.목록) {
      const 색 = x.수준 === 'crit' ? 'crit' : x.수준 === 'warn' ? 'warn'
        : x.수준 === 'unknown' ? 'off' : x.수준 === 'info' ? 'off' : 'good'
      const 표 = x.수준 === 'crit' ? '▲' : x.수준 === 'warn' ? '▲' : x.수준 === 'unknown' ? '?' : '●'
      줄(g5, x.이름, badge(색, 표, String(x.현재)), x.왜 || (`권장: ${x.권장}`))
    }

    /**
     * 🔴 문제를 보는 자리와 고치는 자리가 이어져 있어야 한다.
     *   CLI 에만 고치는 법이 있으면, 화면만 보는 사람은 "감시 정상"을 보면서
     *   자리를 비우는 순간 멎을 PC 를 그대로 쓴다.
     *
     * 요약에는 **여는 단추 하나만** 둔다. 바꾸는 단추·되돌리기·수동 안내는 모달에
     * 있다 — 같은 동작을 두 곳에 두면 어느 쪽이 최신인지 알 수 없고, 무엇을
     * 바꾸는지 설명할 자리도 없다. 여기서는 "문제가 있다"만 보인다.
     *
     * 🔴 여기에 보관 상태를 다시 적지 않는다.
     *   실측 (2026-09-22): 모달로 옮기면서 지역 변수 `백업`·`고칠수있나` 를 지웠는데
     *   그것을 읽는 줄이 남아 ReferenceError 가 났다. 그리기() 는 요약을 목록보다
     *   먼저 부르므로 **세션 목록이 통째로 비었다** — 서버는 8개를 정상으로 주고
     *   있었는데. 화면에서 옮긴 것은 옮긴 자리에만 있어야 한다.
     */
    const 단추 = el('div', 'pcbtn')
    const 열기 = el('button', 'sm' + (pc.수준 === 'crit' ? ' primary' : ''), 'PC 설정 열기')
    열기.type = 'button'
    열기.dataset.pc = 'manual'
    열기.title = '자동 설정 · 직접 고르기 · 되돌리기 · 수동 방법을 한 화면에서'
    단추.append(열기)
    g5.append(단추)

    box.append(g5)
  }

  updateDigest(d)
}

/**
 * 접었을 때 띠에 남는 한 줄 요지.
 *
 * 🔴 접었다고 아무것도 모르면 안 된다. 접는 이유는 자리를 비우려는 것이지
 *   상태를 포기하려는 것이 아니다. 가장 자주 보는 것만 한 줄로 남긴다.
 */
function updateDigest(d) {
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


export { drawAlerts, drawTiles }
