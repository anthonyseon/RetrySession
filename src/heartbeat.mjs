/**
 * heartbeat.mjs — 감시를 켠 세션마다 "지금 어디까지 왔는가"를 디스크에 남긴다.
 *
 * 왜 필요한가 (추적기·트랜스크립트만으로는 부족하다)
 *   추적기는 **단계 경계**에서만 갱신된다. 한 단계가 길면(원본 계획의 W3-2 는 수정 64건,
 *   W1 은 문서 42건) 중간에 끊겼을 때 "doing" 이라고만 말하고 그 안에서 어디까지 했는지는
 *   말해주지 않는다. 트랜스크립트는 그 답을 갖고 있지만 21MB 다 — 재개할 때 읽을 것이 아니다.
 *   이 파일이 5분마다 **요약 한 장**을 남겨 그 구간을 메운다.
 *
 * 🔴 왜 --loop 이 없는가 (실측 사고)
 *   2026-09-16 23:02 ~ 09-17 08:04 (9시간) setInterval 이 멈춰 기록이 끊겼다.
 *   절전 아님(Kernel-Power 0건) · 재부팅 아님(가동 46.6h) · 프로세스 사망 아님(PID 28472 생존).
 *   PC 는 깨어 있었고 프로세스도 살아 있었는데 **타이머만 멈췄다.**
 *   장수 타이머를 버렸다 — 5분마다 OS 가 새 프로세스로 띄우면 얼어붙을 타이머가 없다.
 *   **이 파일에 --loop 을 다시 넣지 마라. 그게 사고의 원인이었다.**
 *
 * 사용법
 *   node src/heartbeat.mjs           감시 켜진 세션 전부 1회 기록
 *   node src/heartbeat.mjs --check   살아있는지 판정만 (기록 안 함. 낡으면 exit 1)
 *   node src/heartbeat.mjs --list    감시 대상 목록
 */
import { readFileSync } from 'node:fs'
import { localStamp } from './lib/stamp.mjs'
import { heartbeatVerdict } from './lib/guard.mjs'
import { loadTargets, statePaths, 세션id인가 } from './lib/targets.mjs'
import { 원자JSON쓰기, 덧붙이기 } from './lib/io.mjs'
import { fullStatus } from './lib/status.mjs'
import { sessionDetail } from './lib/detail.mjs'
import { 작업이름 } from './lib/scheduler.mjs'
import { 단일실행 } from './lib/single.mjs'
import { 변화기록 } from './lib/alerts.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)

/* ── --list ─────────────────────────────────────────────────── */
if (flag('--list')) {
  const t = loadTargets()
  const rows = Object.entries(t.targets)
  if (!rows.length) console.log('감시·재시작 대상이 없다. UI 에서 세션을 골라 켜라 (npm run ui).')
  for (const [id, v] of rows) {
    console.log(`${id.slice(0, 8)} · 감시 ${v.감시 ? 'O' : 'X'} · 재시작 ${v.재시작 ? 'O' : 'X'} · ${v.제목 || v.실행cwd || ''}`)
  }
  process.exit(0)
}

/* ── --check : fail-closed 판정. 모르면 죽음으로 본다 ────────── */
if (flag('--check')) {
  const t = loadTargets()
  const 감시 = Object.entries(t.targets).filter(([, v]) => v.감시)
  if (!감시.length) {
    console.log('ℹ 감시 대상이 없다 — 판정할 것이 없다 (이것은 정상이다)')
    process.exit(0)
  }
  let 죽음 = 0
  for (const [id, v] of 감시) {
    // 형태가 아닌 id 는 판정할 수 없다 = 살아있다고 말할 수 없다 (fail-closed)
    if (!세션id인가(id)) {
      죽음++
      console.error(`✖ '${String(id).slice(0, 40)}' — 세션 id 형태가 아니다. 등록부를 확인하라`)
      continue
    }
    const P = statePaths(id)
    let hb = null
    try { hb = JSON.parse(readFileSync(P.하트비트, 'utf8')) } catch { hb = null }
    const 한계 = v.낡음한계분 ?? 15
    const 켠epoch = typeof v.감시켠epoch === 'number'
      ? v.감시켠epoch
      : (Date.parse(v.갱신시각 || v.추가시각 || '') || null)
    const r = heartbeatVerdict(hb, 한계, Date.now(), 켠epoch)
    const 이름 = `${id.slice(0, 8)} ${v.제목 ? `(${v.제목.slice(0, 30)})` : ''}`
    if (r.alive) console.log(`✅ ${이름} — ${r.ageMin}분 전 기록 (한계 ${한계}분)`)
    /**
     * 🔴 대기는 죽음이 아니다 — 아직 쓸 기회가 없었을 뿐이다.
     *   fail-closed 를 어기는 것이 아니다: 대기 창은 한계 시간까지만이고
     *   그 뒤에는 위의 판정이 죽음으로 답한다. 모르는 것을 정상이라 하는 게 아니라,
     *   **아직 때가 아닌 것**을 고장이라 하지 않는 것이다.
     */
    else if (r.대기) console.log(`◔ ${이름} — ${r.why}`)
    else { 죽음++; console.error(`✖ ${이름} 하트비트 죽음 — ${r.why}`) }
  }
  if (죽음) {
    console.error('')
    console.error(`  되살리기: powershell -Command "Start-ScheduledTask -TaskName ${작업이름.하트비트}"`)
    console.error('  작업이 아예 없으면 재등록: powershell -ExecutionPolicy Bypass -File scripts/register-heartbeat.ps1')
    process.exit(1)
  }
  process.exit(0)
}

/* ── 기본: 1회 기록 ─────────────────────────────────────────── */

/**
 * 🔴 한 번에 하나만 기록한다.
 *   둘이 같은 heartbeat.json 을 덮어쓰면 기록이 찢어진다. 예약의
 *   MultipleInstances IgnoreNew 는 스케줄러끼리만 막으므로, 사람이 손으로 돌리거나
 *   화면·트레이에서 "지금 실행"을 누른 경우가 겹칠 수 있다.
 *   한 회차는 보통 몇 초다 — 30분을 넘겼다면 죽은 락으로 본다.
 */
단일실행('heartbeat', { 낡음분: 30 })

const 등록 = loadTargets()
const 켜진것 = Object.entries(등록.targets).filter(([, v]) => v.감시).map(([id]) => id)

// 세션 id 형태가 아닌 항목은 경로가 될 수 없다. 알린 뒤 건너뛴다 —
// 한 줄이 이상하다고 나머지 감시까지 멈추면 그게 더 나쁘다.
const 감시대상 = 켜진것.filter(세션id인가)
for (const 나쁜 of 켜진것.filter((id) => !세션id인가(id))) {
  console.warn(`⚠ 등록부의 '${String(나쁜).slice(0, 40)}' 는 세션 id 형태가 아니다 — 건너뛴다`)
}

if (!감시대상.length) {
  console.log(`하트비트 ${localStamp()} — 감시 대상이 없다. 기록할 것이 없다.`)
  process.exit(0)
}

// 집계는 한 번만 한다 — CLI 호출과 스캔이 들어 있어 세션마다 다시 하면 낭비다
const S = fullStatus()
const 세션맵 = new Map(S.세션.map((s) => [s.sessionId, s]))

/**
 * 경보 이력은 여기서 남긴다 — 5분마다 도는 것이 이것뿐이기 때문이다.
 *
 * 화면을 닫아둔 사이에 생긴 일을 놓치면 안 되고, 그렇다고 Windows 풍선으로
 * 띄우지도 않는다(너무 자주 떠서 진짜 경고가 묻혔다). **변화가 있을 때만** 적는다.
 */
const 경보변화 = 변화기록(S.경보 || [])
if (경보변화.기록) {
  const n = (S.경보 || []).length
  console.log(n ? `⚠ 경보 ${n}건 (변화 기록됨)` : '✅ 경보 해소 (기록됨)')
  for (const a of S.경보 || []) console.log(`   ${a.수준} · ${a.제목} — ${a.설명}`)
}

for (const id of 감시대상) {
  const P = statePaths(id)
  const s = 세션맵.get(id)

  if (!s) {
    // 등록은 돼 있는데 세션이 사라졌다(정리됨·purge). 감추지 않고 그대로 남긴다.
    const 없음 = {
      _주의: '5분마다 덮어쓴다. 추적하지 않는다 — 단계 경계 기록은 대상 저장소의 추적기가 정본이다.',
      at: localStamp(), atEpoch: Date.now(), sessionId: id,
      오류: '이 세션을 찾을 수 없다 — 트랜스크립트가 정리됐거나 claude project purge 된 것으로 보인다',
    }
    원자JSON쓰기(P.하트비트, 없음)
    덧붙이기(P.하트비트로그, `${없음.at} · (세션 없음) · ${없음.오류}`)
    console.warn(`⚠ ${id.slice(0, 8)} — 세션을 찾을 수 없다`)
    continue
  }

  // 트랜스크립트 꼬리에서 "무엇을 하던 중인가" — 21MB 여도 512KB 만 읽는다
  let 진행 = null, 미완결 = []
  try {
    const d = sessionDetail(id, { turns: 3, maxBytes: 256 * 1024, 글길이: 300 })
    if (d.ok) { 진행 = d.진행; 미완결 = d.진행.미완결도구 }
  } catch { /* 상세 실패로 기록을 끊지 않는다 */ }

  const snap = {
    _주의: '5분마다 덮어쓴다. 추적하지 않는다(.gitignore) — 단계 경계 기록은 대상 저장소의 추적기가 정본이다.',
    // 🔴 시각은 로컬 시간. UTC 로 적으면 KST 기준 9시간 낡아 보여 오판을 부른다(실측).
    at: localStamp(),
    atEpoch: Date.now(), // 낡음 판정은 문자열이 아니라 이 값으로 한다
    sessionId: id,
    제목: s.제목,
    실행중: s.실행중, 실행여부앎: s.실행여부앎 !== false, pid: s.pid,
    활성분: s.활성분,
    실행cwd: s.실행cwd, 주작업cwd: s.주작업cwd,
    저장소: s.저장소id,
    현재단계: s.추적기.있음
      ? { id: s.추적기.doing?.id || '(doing 없음)', title: s.추적기.doing?.title, evidence: s.추적기.doing?.evidence, 완료단계: s.추적기.완료표기 }
      : { id: '(추적기 없음)' },
    nextAction: s.추적기.nextAction || null,
    전부완료: !!s.추적기.전부완료,
    doing위반: s.추적기.doing위반 || null,
    진행,
    git: s.git,
    사용량: { 토큰합: s.토큰합, 비용USD: s.비용USD, 메시지: `u${s.사용자메시지}/a${s.어시스턴트메시지}`, 도구호출: s.도구호출 },
    할당량: S.할당량,
  }
  /**
   * 🔴 원자적으로 쓴다. 이 파일은 "살아 있나"의 정본이고, 판정은 fail-closed 라
   *   반쯤 쓰인 JSON 은 곧바로 "감시 끊김" 경보가 된다. 5분마다 쓰는 파일이니
   *   그 창을 없애 두지 않으면 언젠가 그 순간에 맞는다.
   */
  원자JSON쓰기(P.하트비트, snap)

  const 도구 = 미완결.length ? `도구중 ${미완결.map((t) => t.이름).join(',')}` : (진행?.마지막종류 || '-')
  덧붙이기(P.하트비트로그, [
    snap.at,
    // 🔴 조회 실패를 '정지'로 적으면 나중에 이 기록을 읽는 사람이 속는다
    s.실행여부앎 === false ? '실행여부모름' : (s.실행중 ? '실행중' : '정지'),
    snap.현재단계.id,
    snap.현재단계.완료단계 || '',
    `HEAD ${s.git?.head || '-'}`,
    `미커밋 ${s.git?.미커밋파일수 ?? '-'}`,
    도구,
  ].join(' · ') + '\n')

  console.log(
    `하트비트 [${id.slice(0, 8)}] ${snap.at} · ` +
    `${s.실행여부앎 === false ? '실행여부모름' : (s.실행중 ? '실행중' : '정지')}` +
    ` · 단계 ${snap.현재단계.id}${snap.현재단계.완료단계 ? ` (${snap.현재단계.완료단계})` : ''}` +
    ` · 미커밋 ${s.git?.미커밋파일수 ?? '-'}`
  )
  if (snap.doing위반) console.warn(`  ⚠ doing 이 ${snap.doing위반.length}개다 (${snap.doing위반.join(', ')}) — 규약은 한 번에 하나다`)
}
