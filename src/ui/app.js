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
import { $, S, actions, keepScroll, drawPiece } from './common.js'
import { drawAlerts, drawTiles } from './summary.js'
import { drawFolders, items, syncSelection } from './list.js'
import { redrawDetail } from './detail.js'
import { openSettings, closeSettings, drawSettings, isSettingsOpen, pcAction } from './setup.js'
import { initLayout } from './layout.js'


/* ── 통신 ────────────────────────────────────────────────────── */
/**
 * 🔴 보내다 실패하면 **말해준다.**
 *
 *   실측 (2026-09-22): 서버가 바쁠 때 POST 가 ECONNRESET 으로 끊겼다. 이 함수에는
 *   try 가 없어서 그 예외가 클릭 처리기 밖으로 빠져나갔고 — 화면에는 아무 일도
 *   일어나지 않는다. 사람은 단추가 안 먹었다고 생각하고 다시 누른다.
 *   누른 것이 먹었는지 아닌지는 반드시 보여야 한다.
 */
async function post(path, body) {
  let r
  try {
    r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch (e) {
    alert(`보내지 못했습니다 — ${e.message}\n\n서버가 바쁘거나 멈췄을 수 있습니다. 잠시 뒤 다시 눌러 주세요.`)
    await loadStatus()
    return null
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) alert('실패: ' + (j.error || r.status))
  await loadStatus()
  return j
}

const meta = (s) => ({
  title: s.title, runCwd: s.runCwd, mainCwd: s.mainCwd, slug: s.slug,
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
async function errorReason(r) {
  try {
    const j = await r.json()
    if (j?.error) return `${j.error} (HTTP ${r.status})`
  } catch { /* JSON 이 아니면 아래로 */ }
  return `HTTP ${r.status}`
}

/**
 * 🔴 서버가 새로 떴으면 **화면도 새로 읽는다.**
 *
 *   실측 (2026-09-22): `start.ps1 -Restart` 로 서버는 새 코드를 들고 떴는데, 이미
 *   열려 있던 상태창은 옛 모듈(app.js·summary.js)을 그대로 들고 폴링을 계속했다.
 *   방금 고친 결함이 화면에서는 살아 있고 아무도 경고하지 않는다 — 이 저장소를
 *   만드는 동안 세 번 걸린 함정이고, 창을 하나만 띄우는 규칙 때문에 사람이
 *   "닫고 다시 열기"로 해결할 수도 없다(같은 창을 앞으로 가져온다).
 *
 *   그래서 기동 시각이 바뀌면 한 번만 스스로 다시 읽는다. 폴링마다 확인하지 않고
 *   상태 읽기에 곁붙이지도 않는다 — /api/ping 은 값싸고, 실패해도 그냥 넘긴다.
 */
let serverBoot = null
async function checkBoot() {
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' })
    if (!r.ok) return
    const j = await r.json()
    // bootEpoch — /api/ping 은 ASCII 키만 쓴다(ANSI 로 읽히는 .ps1 들이 본다)
    if (!j?.bootEpoch) return
    if (serverBoot === null) { serverBoot = j.bootEpoch; return }
    if (serverBoot !== j.bootEpoch) location.reload()
  } catch { /* 못 물어봤으면 다음에 다시 — 이것 때문에 화면이 멈추면 안 된다 */ }
}

async function loadStatus() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' })
    if (!r.ok) throw new Error(await errorReason(r))
    S.state = await r.json(); S.lastOkAt = Date.now(); S.error = null
  } catch (e) { S.error = e.message }
  draw()
}

async function loadDetail() {
  if (!S.openSession) return
  try {
    const r = await fetch(`/api/session/${encodeURIComponent(S.openSession)}?turns=60`, { cache: 'no-store' })
    // 🔴 조용히 넘기지 않는다. 상세가 안 열리는데 이유를 안 말하면 사람은 화면이
    //   멈춘 줄 안다(실제로 겪은 부류의 실패다).
    if (r.ok) { S.detail = await r.json(); S.detailError = null }
    else S.detailError = await errorReason(r)
  } catch (e) { S.detailError = e.message }
  redrawDetail()
}

/**
 * 🔴 조각을 **각각** 그린다. 하나가 던져도 나머지는 그려야 한다.
 *
 *   실측 결함 (2026-09-22): `경보그리기(d); 타일들(d); …; 목록(d)` 을 한 줄에
 *   이어 불렀다. 요약(타일들)에서 ReferenceError 가 나자 그 뒤의 목록이 아예
 *   실행되지 않아 **세션 목록이 빈 채로** 남았다. 서버는 8개를 정상으로 주고
 *   있었으니, 화면이 있는 것을 없다고 말한 셈이다.
 *
 *   실패를 삼키지는 않는다 — 신선도 줄에 어느 조각이 왜 죽었는지 적는다.
 */
function draw() {
  const d = S.state
  // 🔴 상태가 없어도 경보는 그린다 — 첫 요청부터 실패했을 때 빈 화면만 뜨면
  //   사람은 무엇이 잘못됐는지 알 길이 없다.
  if (!d) { S.drawError = drawPiece('경보', () => drawAlerts(null)); updateFreshness(); return }

  const failed = [
    drawPiece('계정', () => {
      $('#acct').textContent = d.account.email ? `${d.account.email} · ${d.account.subscriptionType || ''}` : '계정 확인 실패'
    }),
    drawPiece('경보', () => drawAlerts(d)),
    drawPiece('요약', () => drawTiles(d)),
    drawPiece('폴더', () => drawFolders(d)),
    drawPiece('PC 설정', () => drawSettings()),
    drawPiece('세션 목록', () => keepScroll('#slist', () => { items(d); syncSelection() })),
    drawPiece('상세', () => redrawDetail()),
  ].filter(Boolean)
  S.drawError = failed.length ? failed.join(' · ') : null
  updateFreshness()
}

/**
 * 🔴 신선도는 갱신과 **따로** 1초마다 고친다.
 *   화면 전체를 1초마다 다시 그리면 체크박스·스크롤이 튄다. 그리고 사람이 알아야 하는 것은
 *   "이 화면이 몇 초 전 것이냐"다 — 그 한 줄만 자주 고치면 멈춘 화면을 바로 알아챈다.
 */
function updateFreshness() {
  const seconds = S.lastOkAt ? Math.round((Date.now() - S.lastOkAt) / 1000) : null
  const dot = $('#dot')
  // 🔴 그리기가 깨진 것도 '이상'이다. 값은 새것인데 화면이 옛것·빈것일 수 있다.
  const isBad = Boolean(S.error || S.drawError)
  dot.className = 'dot' + (isBad ? ' off' : seconds === null ? ' off' : seconds > 12 ? ' stale' : '')
  if (S.error) $('#freshness').textContent = `읽기 실패${seconds !== null ? ` (${seconds}초 전 성공)` : ''} — ${S.error}`
  else if (!S.state) $('#freshness').textContent = '연결 중…'
  // 🔴 여기는 drawPiece 바깥이다 — 한 칸이 없다고 던지면 신선도 줄이 통째로 멈춘다.
  //   "몇 초 전 화면이냐"는 고장났을 때 가장 필요한 한 줄이므로 값이 모자라도 그린다.
  else $('#freshness').textContent = `${S.state.at} · ${seconds}초 전 갱신 · 스캔 ${S.state.scan?.ms ?? '?'}ms`
    + (S.drawError ? ` · ⚠ 화면 그리기 실패 — ${S.drawError}` : '')
}

/* ── 사건 ────────────────────────────────────────────────────── */
document.querySelector('.actions').addEventListener('click', async (e) => {
  const act = e.target.dataset?.act
  if (!act || !S.picked.size) return
  const ids = [...S.picked]
  /**
   * 🔴 이름을 `meta` 로 두지 마라 — 위의 `meta(s)` 를 가린다.
   *
   *   실측 결함 (2026-09-22): 이름을 영어로 바꾸는 과정에서 세션 정보를 만드는
   *   `meta(s)` 와 그 결과를 담는 그릇이 **둘 다 `meta`** 가 됐다. 안쪽 `const meta = {}`
   *   가 바깥 함수를 가려 `meta(s)` 가 `TypeError: meta is not a function` 으로 터졌고,
   *   **동작줄의 단추 여섯 개가 전부 아무것도 보내지 않았다.** 오류는 콘솔에만 남아
   *   화면은 조용했다 — 눌렀는데 아무 일도 안 일어나는, 가장 알아채기 어려운 고장이다.
   *   시험은 소스 정규식과 그리기만 봤기 때문에 못 잡았다(이제 ui-actions 가 눌러 본다).
   */
  const metaById = {}
  for (const id of ids) {
    const s = S.state?.sessions.find((x) => x.sessionId === id)
    if (s) metaById[id] = meta(s)
  }
  if (act === 'watch-on') await apply('/api/targets', '감시를 켰습니다', ids, { sessionIds: ids, watch: true, meta: metaById })
  else if (act === 'watch-off') await apply('/api/targets', '감시를 껐습니다', ids, { sessionIds: ids, watch: false, meta: metaById })
  else if (act === 'resume-on') {
    if (!confirm(`${ids.length}개 세션에 자율 재시작을 켭니다.\n\n사람이 보지 않는 상태에서 OS 예약이 claude --resume 을 띄워 토큰을 쓰고 파일을 고칠 수 있습니다. 가드(실행 중 확인·하루 횟수·비용 상한·연속실패 차단)는 걸려 있습니다.\n\n계속할까요?`)) return
    await apply('/api/targets', '재시작을 켰습니다', ids, { sessionIds: ids, restart: true, meta: metaById })
  }
  else if (act === 'resume-off') await apply('/api/targets', '재시작을 껐습니다', ids, { sessionIds: ids, restart: false, meta: metaById })
  else if (act === 'rearm') await apply('/api/rearm', '차단을 해제했습니다', ids, { sessionIds: ids })
  else if (act === 'remove') {
    if (!confirm(`${ids.length}개 세션의 등록을 해제합니다. 감시·재시작이 모두 꺼집니다.`)) return
    await apply('/api/targets/remove', '등록을 해제했습니다', ids, { sessionIds: ids })
    S.picked.clear()
  }
})

/**
 * 보내고 **결과를 화면에 말한다.**
 *
 * 🔴 실측 (2026-09-22, 사용자 보고 두 번): [재시작 시작] 을 눌렀는데 "적용이 안 되는
 *   것 같다"고 했다. 등록부에는 제대로 써졌지만 화면이 아무 말도 하지 않았고, 배지는
 *   `지금은 대기 — 세션이 실행 중이다` 로 바뀌어 **누른 것이 먹혔는지 알 수 없었다.**
 *   설정이 바뀐 것과 지금 돌 수 있는 것은 다른 사실인데, 화면은 후자만 보여줬다.
 *
 * 🔴 켜 놓고 "지금은 안 돈다"를 함께 말한다. 켰다는 말만 하면 사람은 곧 돌 것으로
 *   기대하고, 안 돌면 또 같은 것을 묻는다.
 */
async function apply(path, done, ids, body) {
  const box = $('#actMsg')
  box.textContent = '보내는 중…'
  const r = await post(path, body)
  /**
   * 🔴 `post` 는 **실패해도 본문을 돌려준다**(null 은 연결 실패뿐이다).
   *   그것을 성공으로 읽으면 "✅ 적용됐습니다" 라고 거짓말하게 된다 —
   *   이 함수가 고치려는 바로 그 부류의 사고다. 오류가 담겨 있으면 오류라고 말한다.
   */
  if (r === null) { box.textContent = '✖ 보내지 못했습니다 — 위의 안내를 보세요'; return }
  if (r.error) { box.textContent = `✖ 적용하지 못했습니다 — ${r.error}`; return }
  let msg = `✅ ${ids.length}개 — ${done}`
  // 켜자마자 돌지 않는 것이 정상인 경우를 그 자리에서 알려준다
  if (body.restart === true) {
    const waiting = ids
      .map((id) => S.state?.sessions.find((x) => x.sessionId === id))
      .filter((s) => s && !s.restart?.gate?.go).length
    if (waiting) msg += ` (그중 ${waiting}개는 지금 조건이 안 맞아 대기 — 목록의 배지를 보세요)`
  }
  box.textContent = msg
}

document.querySelector('#dtabs').addEventListener('click', (e) => {
  if (!e.target.dataset?.tab) return
  S.tab = e.target.dataset.tab; redrawDetail()
})

$('#btnRefresh').addEventListener('click', () => { loadStatus(); loadDetail() })
$('#btnAuto').addEventListener('click', () => {
  S.auto = !S.auto
  const b = $('#btnAuto')
  b.textContent = S.auto ? '자동갱신 켬' : '자동갱신 끔'
  // 🔴 글자만 바뀌면 지금 어느 쪽인지 훑어서 모른다 — 배지와 같은 색 채널을 쓴다
  b.classList.toggle('sw-on', S.auto)
  b.classList.toggle('sw-off', !S.auto)
})
$('#btnTheme').addEventListener('click', () => {
  const toLight = document.documentElement.dataset.theme !== 'light'
  document.documentElement.dataset.theme = toLight ? 'light' : 'dark'
  $('#btnTheme').textContent = toLight ? '어둡게' : '밝게'
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
// 🔴 저장 키도 영어다 — 문자열로 들고 다니는 키는 이름 검사기가 못 본다(CLAUDE.md 2-2)
const foldKey = 'rs.foldSummary'

function applySummary(folded, { save = true } = {}) {
  $('#top').classList.toggle('hide', folded)
  $('#btnTop').setAttribute('aria-expanded', String(!folded))
  $('#btnTopIc').textContent = folded ? '▸' : '▾'
  $('#btnTopTx').textContent = folded ? '요약 펴기' : '요약 접기'
  $('#btnTop').title = folded
    ? '요약을 펴면 계정·사용량·OS 트리거를 볼 수 있습니다'
    : '요약을 접으면 세션과 상세가 넓어집니다'
  if (save) { try { localStorage.setItem(foldKey, folded ? '1' : '0') } catch { /* 저장 못 해도 동작은 한다 */ } }
}

$('#btnTop').addEventListener('click', () => {
  applySummary($('#btnTop').getAttribute('aria-expanded') === 'true')
})

// 기억해 둔 상태로 시작한다
try { applySummary(localStorage.getItem(foldKey) === '1', { save: false }) }
catch { applySummary(false, { save: false }) }
/* ── PC 설정·모달 단추 받기 ─────────────────────────────────── */
/**
 * PC 관련 단추는 요약과 모달 두 곳에 있다 — 한 곳에서 받는다.
 * 규칙을 두 벌로 만들지 않는 것과 같은 이유다. (하는 일은 setup.js 에 있다)
 */
document.addEventListener('click', (e) => {
  const act = e.target?.dataset?.pc
  if (act) { pcAction(act); return }
  if (e.target?.dataset?.setup === 'close') closeSettings()
})

/* ── 설정 모달 ───────────────────────────────────────────────── */

$('#btnSetup').addEventListener('click', () => (isSettingsOpen() ? closeSettings() : openSettings()))
$('#btnSetupClose').addEventListener('click', closeSettings)

/**
 * 🔴 모달은 사라져야 한다 — 바깥을 눌러도, Esc 를 눌러도 닫힌다.
 *   트레이 메뉴에서 배운 것과 같다: 닫히지 않는 것은 없는 것보다 나쁘다.
 *   sheet 안쪽 클릭은 닫지 않는다(내용을 고르다 닫히면 안 된다).
 */
$('#setupWrap').addEventListener('click', (e) => { if (e.target.id === 'setupWrap') closeSettings() })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isSettingsOpen()) closeSettings() })

$('#onlyReg').addEventListener('change', (e) => { S.onlyRegistered = e.target.checked; draw() })

/**
 * 🔴 조각들이 쓸 동작을 등록한다. 이것을 빠뜨리면 클릭이 조용히 아무 일도 하지 않는다
 *   (오류도 안 난다 — common.js 의 기본값이 빈 함수라서). 시험이 이 등록을 확인한다.
 */
/** 동작줄에 한 줄 적는다. 조각(detail.js 등)이 누른 결과를 말할 때 쓴다 */
const say = (text) => { const b = $('#actMsg'); if (b) b.textContent = text }
Object.assign(actions, { draw, loadStatus, loadDetail, post, meta, say })

/* ── 시작 ────────────────────────────────────────────────────── */

// 너비 조절 손잡이와 세션 영역 접기. 저장해 둔 배치를 먼저 적용한다 —
// 첫 그리기 뒤에 배치가 튀면 사람은 화면이 덜컹거린다고 느낀다.
initLayout()
/**
 * 🔴 폴링은 **겹치지 않게** 한다.
 *
 *   실측 (2026-09-22): /api/status 한 번이 0.9초(캐시가 더울 때)에서 11초(식었을 때)
 *   걸린다. 서버는 한 스레드이고 그동안 이벤트 루프가 막힌다. 그런데 화면은
 *   `setInterval(3000)` 으로 **앞 요청이 끝났는지 보지 않고** 계속 새로 보냈다 —
 *   느려질수록 요청이 쌓이고 쌓일수록 더 느려진다. 실제로 그 상태에서 POST 가
 *   ECONNRESET 으로 끊겼다.
 *
 *   끝난 뒤에 다음을 잡는다. 실패해도 멈추지 않는다 — 멈추면 화면이 그대로 굳는다.
 */
function pollLoop(fn, ms, shouldRun = () => true) {
  const tick = async () => {
    if (shouldRun()) {
      try { await fn() } catch (e) { console.error('[폴링] 실패', e) }
    }
    setTimeout(tick, ms)
  }
  setTimeout(tick, ms)
}

loadStatus()
checkBoot()
pollLoop(loadStatus, 3000, () => S.auto)
// 서버가 다시 떴는지 5초마다 — 고친 코드가 화면에 반영되지 않는 것이 이 저장소의 상습 함정이다
pollLoop(checkBoot, 5000)
pollLoop(loadDetail, 2000, () => S.auto && Boolean(S.openSession))
// 신선도만 1초마다 — 화면이 멈췄는지 사람이 바로 안다 (전체를 다시 그리지 않는다)
setInterval(updateFreshness, 1000)
