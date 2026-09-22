/**
 * app.js — 상태 화면의 진입점. 통신·사건·폴링만 맡는다.
 *
 * 그리는 코드는 조각으로 나뉘어 있다 — summary.js · list.js · detail.js.
 * 공용 도구와 `동작` 등록소는 common.js 에 있다.
 *
 * 갱신 방식
 *   목록·요약은 3초, 열려 있는 상세는 2초마다 다시 읽는다. SSE 가 아니라 폴링인 이유는
 *   이 도구가 "다른 것이 다 멈췄을 때 살아 있어야 하는" 감시 장치라서다 —
 *   연결이 끊겼다 붙는 상황에서 폴링이 더 단순하고 덜 고장난다.
 *   대신 마지막 성공 시각을 항상 화면에 적어, 화면이 멈춘 것을 사람이 알 수 있게 한다.
 *
 * 🔴 상태는 색만으로 나르지 않는다. 배지는 아이콘+라벨+색 세 벌을 함께 쓴다.
 */
'use strict'
import { $, S, 동작, 스크롤유지 } from './common.js'
import { 경보그리기, 타일들 } from './summary.js'
import { 폴더그리기, 목록, 선택갱신 } from './list.js'
import { 상세다시그리기 } from './detail.js'

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

/**
 * 서버가 오류로 답했을 때 **이유를 꺼낸다.**
 *
 * 🔴 실측 결함 (2026-09-21): `throw new Error('HTTP ' + r.status)` 였다.
 *   서버는 본문에 `{"오류":"등록부가 깨졌다 (…): Expected property name…"}` 를
 *   담아 보내는데 화면은 그걸 버리고 "HTTP 500" 만 보여줬다. 고칠 수 있는 이유를
 *   숫자로 바꿔 놓은 셈이다 — 이 저장소가 계속 고쳐 온 그 실수(코드 4294967295)와
 *   같은 부류다. 감시 장치는 **무엇이 잘못됐는지**를 말해야 한다.
 */
async function 오류이유(r) {
  try {
    const j = await r.json()
    if (j?.오류) return `${j.오류} (HTTP ${r.status})`
  } catch { /* JSON 이 아니면 아래로 */ }
  return `HTTP ${r.status}`
}

async function 상태읽기() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' })
    if (!r.ok) throw new Error(await 오류이유(r))
    S.상태 = await r.json(); S.마지막성공 = Date.now(); S.오류 = null
  } catch (e) { S.오류 = e.message }
  그리기()
}

async function 상세읽기() {
  if (!S.열린세션) return
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(S.열린세션)}?turns=60`, { cache: 'no-store' })
    // 🔴 조용히 넘기지 않는다. 상세가 안 열리는데 이유를 안 말하면 사람은 화면이
    //   멈춘 줄 안다(실제로 겪은 부류의 실패다).
    if (r.ok) { S.상세 = await r.json(); S.상세오류 = null }
    else S.상세오류 = await 오류이유(r)
  } catch (e) { S.상세오류 = e.message }
  상세다시그리기()
}

function 그리기() {
  const d = S.상태
  신선도갱신()
  // 🔴 상태가 없어도 경보는 그린다 — 첫 요청부터 실패했을 때 빈 화면만 뜨면
  //   사람은 무엇이 잘못됐는지 알 길이 없다.
  if (!d) { 경보그리기(null); return }
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
/* ── PC 설정 바꾸기 ─────────────────────────────────────────── */
/**
 * 🔴 남의 PC 설정을 바꾸는 일이라 반드시 확인을 받는다. 되돌릴 수 있다는 것도
 *   함께 말한다 — 되돌릴 길을 모르면 사람은 누르지 못한다.
 *   규칙(백업 먼저·배터리 제외·바꾼 뒤 재확인)은 서버가 src/pc.mjs 를 불러 지킨다.
 */
async function pc동작(action) {
  // 수동 안내는 서버를 부를 일이 없다 — 이미 받아 둔 문구를 보여주기만 한다
  if (action === 'manual') {
    const 안내 = S.상태?.pc?.안내
    alert(Array.isArray(안내) ? 안내.join('\n') : '안내를 아직 받지 못했습니다. 잠시 뒤 다시 누르세요.')
    return
  }

  const 물음 = action === 'apply'
    ? [
      'PC 전원 설정을 바꿉니다.',
      '',
      '· 전원이 연결된 상태에서 잠들지 않도록 합니다.',
      '· 배터리 설정은 건드리지 않습니다 (배터리를 태우지 않기 위해).',
      '· 바꾸기 전 값을 저장하므로 언제든 되돌릴 수 있습니다.',
      '',
      '계속할까요?',
    ].join('\n')
    : 'PC 전원 설정을 바꾸기 전 값으로 되돌립니다.\n\n계속할까요?'
  if (!confirm(물음)) return

  const r = await 보내기('/api/pc', { action })
  // 결과를 그대로 보여준다 — "바꿨다"만 말하고 실제로 안 바뀌면 그게 최악이다
  if (r && r.출력) alert(r.출력)
}

document.addEventListener('click', (e) => {
  const act = e.target?.dataset?.pc
  if (act) pc동작(act)
})

$('#onlyReg').addEventListener('change', (e) => { S.등록만 = e.target.checked; 그리기() })

/**
 * 🔴 조각들이 쓸 동작을 등록한다. 이것을 빠뜨리면 클릭이 조용히 아무 일도 하지 않는다
 *   (오류도 안 난다 — common.js 의 기본값이 빈 함수라서). 시험이 이 등록을 확인한다.
 */
Object.assign(동작, { 그리기, 상태읽기, 상세읽기, 보내기, 메타 })

/* ── 시작 ────────────────────────────────────────────────────── */
상태읽기()
setInterval(() => { if (S.자동) 상태읽기() }, 3000)
setInterval(() => { if (S.자동 && S.열린세션) 상세읽기() }, 2000)
// 신선도만 1초마다 — 화면이 멈췄는지 사람이 바로 안다 (전체를 다시 그리지 않는다)
setInterval(신선도갱신, 1000)
