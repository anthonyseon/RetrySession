/**
 * guard.mjs — "지금 실행해도 되는가"를 판정한다. 낡음 판정 · 조용한 시간 · 예산 · 락.
 *
 * 🔴 모든 판정은 fail-closed 다 — 판정에 필요한 값이 없으면 "안 된다"로 답한다.
 *
 *   실측 사고 (2026-09-17): 임시로 쓴 하트비트 판정 코드가 `atEpoch` 가 없을 때
 *   "살아있음"으로 답했고, 실제로는 9시간 낡은 상태였다.
 *   **감시 장치가 "모르면 정상"이라고 답하면 감시가 아니다.**
 *
 * 판정은 순수 함수로 두고 시험으로 고정한다(test/guard.test.mjs). 매번 손으로 쓰면 매번 틀린다.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { localStamp, dayKey, minutesSince, minuteOfDay, parseHhmm } from './stamp.mjs'
import { 원자JSON쓰기 } from './io.mjs'

/* ── 하트비트 낡음 판정 ───────────────────────────────────────── */

/**
 * 하트비트 기록이 살아 있는가. 순수 함수 — 객체를 받아 판정만 한다.
 * @param hb 하트비트 JSON 객체. 읽기 실패면 null 을 넘긴다.
 */
export function heartbeatVerdict(hb, limitMin = 15, now = Date.now(), 켠epoch = null) {
  if (hb === null || typeof hb !== 'object') {
    /**
     * 🔴 "아직 없다" 와 "끊겼다" 는 다르다.
     *
     *   실측 사건 (2026-09-21): 사용자가 ChatTest 세션의 감시를 16:11:49 에 켰다.
     *   하트비트 작업은 16:11:01 에 돌았고 다음은 16:16:00 이었다 — 켜기 38초 전에
     *   지나갔으니 **쓸 기회가 없었다.** 그런데 화면은 5분 동안 치명 경보
     *   «감시가 끊겼습니다 / 하트비트 파일을 읽을 수 없다» 를 띄웠다.
     *
     *   멀쩡한 것을 고장이라 부르는 것은 이 저장소가 반복해서 고쳐 온 실패다
     *   (느린 것을 죽었다고 하기 · 멈춘 것을 실패라 하기 · 모르는 것을 0 이라 하기).
     *   늑대를 외치면 진짜 늑대를 놓친다.
     *
     *   대기는 **한계 시간까지만** 인정한다. 그 뒤에도 첫 기록이 없으면 하트비트가
     *   정말 안 도는 것이므로 죽음으로 답한다 — 창을 무한정 열어두지 않는다.
     */
    if (typeof 켠epoch === 'number' && Number.isFinite(켠epoch)) {
      const 켠뒤 = minutesSince(켠epoch, now)
      if (켠뒤 <= limitMin) {
        return {
          alive: false, 대기: true, ageMin: null,
          why: `감시를 켠 지 ${Math.max(0, Math.round(켠뒤))}분 — 첫 기록을 기다리는 중 (5분마다 기록한다)`,
        }
      }
      return {
        alive: false, 대기: false, ageMin: null,
        why: `감시를 켠 지 ${Math.round(켠뒤)}분이 지났는데 첫 기록이 없다 (한계 ${limitMin}분) — 하트비트가 돌지 않는다`,
      }
    }
    return { alive: false, 대기: false, ageMin: null, why: '하트비트 파일을 읽을 수 없다' }
  }
  if (typeof hb.atEpoch !== 'number') {
    return { alive: false, 대기: false, ageMin: null, why: 'atEpoch 필드가 없다(구 버전이 쓴 파일) — 낡음을 판정할 수 없다' }
  }
  const ageMin = Math.round(minutesSince(hb.atEpoch, now))
  if (ageMin > limitMin) return { alive: false, 대기: false, ageMin, why: `마지막 기록이 ${ageMin}분 전 (한계 ${limitMin}분)` }
  if (ageMin < -5) return { alive: false, 대기: false, ageMin, why: `마지막 기록이 미래다(${ageMin}분) — 시계가 어긋났다` }
  return { alive: true, 대기: false, ageMin, why: null }
}

/* ── 세션이 돌고 있는가 ─────────────────────────────────────── */

/**
 * 이 세션에 지금 사람이 붙어 있는가. **fail-closed 다 — 모르면 "돌고 있다"로 답한다.**
 *
 * 🔴 실측 결함 (2026-09-21, 고치기 전)
 *   resume.mjs 가 `runningSessions()` 의 `ok` 를 보지 않고 `sessions` 배열만 썼다.
 *   CLI 호출이 실패하면(claude 없음·타임아웃·JSON 아님) 그 배열은 **빈 배열**이 되고,
 *   그러면 모든 세션이 "안 돌고 있다"로 보여 관문이 통째로 열린다.
 *   `--force` 로도 못 건너뛴다고 못박은 그 관문이, 목록 조회 실패 한 번으로 열렸다.
 *
 *   **목록이 비어 있는 것과 "아무도 안 돈다"는 다르다.** 전자는 모른다는 뜻일 수 있다.
 *
 * @param 목록 {{ok:boolean, 오류:string|null, sessions:Array<{sessionId,pid}>}} runningSessions() 결과
 * @param 살아있나 pid 생존 확인 함수 — 목록이 낡았을 수 있으므로 한 번 더 본다
 */
export function 세션실행중(목록, sessionId, 살아있나 = () => true) {
  if (!목록 || 목록.ok !== true) {
    return {
      실행중: true, 확실한가: false,
      why: `실행 중 여부를 확인할 수 없다 — ${목록?.오류 || '목록을 받지 못했다'}. 모르는 채로 밀면 사람이 쓰는 대화에 끼어든다`,
    }
  }
  const s = (목록.sessions || []).find((x) => x.sessionId === sessionId)
  if (!s) return { 실행중: false, 확실한가: true, why: null }
  if (!살아있나(s.pid)) return { 실행중: false, 확실한가: true, why: null }
  return { 실행중: true, 확실한가: true, why: `세션이 실행 중이다 (pid ${s.pid}) — 사람이 쓰는 중이므로 건드리지 않는다` }
}

/* ── 조용한 시간 ─────────────────────────────────────────────── */

/**
 * 지금이 자율 재개를 멈추는 시간대인가. `{from:'23:30', to:'07:00'}` 처럼 자정을 넘길 수 있다.
 * 설정이 null 이면 끈 것이다(false). 형식이 틀리면 fail-closed 로 "조용한 시간"으로 본다.
 */
export function quietNow(quiet, now = new Date()) {
  if (!quiet) return { quiet: false, why: null }
  const from = parseHhmm(quiet.from), to = parseHhmm(quiet.to)
  if (from === null || to === null) {
    return { quiet: true, why: `조용한시간 형식이 잘못됐다(HH:MM 이어야 한다): ${JSON.stringify(quiet)}` }
  }
  const m = minuteOfDay(now)
  const inside = from <= to ? (m >= from && m < to) : (m >= from || m < to)
  return { quiet: inside, why: inside ? `조용한 시간 ${quiet.from}~${quiet.to}` : null }
}

/* ── 실행 상태(예산·회로차단기) ───────────────────────────────── */

export const 빈상태 = () => ({ 마지막실행: null, 일별: {}, 비용일별: {}, 연속실패: 0, 차단: null })

/**
 * 실행 상태를 읽는다.
 * 파일이 **없으면** 첫 실행이므로 빈 상태(허용). 파일이 **깨졌으면** 몇 번 돌았는지
 * 알 수 없으므로 fail-closed — `손상:true` 로 표시해 호출부가 막는다.
 */
export function loadRunState(path) {
  if (!existsSync(path)) return 빈상태()
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'))
    return { ...빈상태(), ...s }
  } catch (e) {
    return { ...빈상태(), 손상: `실행 상태 파일이 깨졌다: ${e.message}` }
  }
}

/**
 * 🔴 원자적으로 쓴다. 이 파일이 찢어지면 loadRunState 가 `손상` 을 달고,
 *   budgetVerdict 가 그걸 보고 재개를 막는다 — 고쳐줄 사람이 올 때까지.
 *   쓰다 죽었다는 이유로 자율 재개가 멈추면 안 된다.
 */
export function saveRunState(path, state) {
  원자JSON쓰기(path, state)
}

/**
 * 예산·회로차단기 판정. 순수 함수.
 *
 * 🔴 비용 상한이 있는 이유 (실측)
 *   `claude -p` 1회는 아무 일도 안 해도 최소 ~$0.21 든다 — 시스템 프롬프트 캐시 생성
 *   21k 토큰이 매 프로세스마다 새로 잡힌다(세션을 재사용하지 않으므로 캐시가 안 걸린다).
 *   횟수 상한만으로는 실제 지출을 못 막는다. 긴 작업 1회가 짧은 작업 10회보다 비싸다.
 *
 * @returns {{ok:boolean, why:string|null, 오늘실행:number, 오늘비용:number}}
 */
export function budgetVerdict(state, cfg, now = Date.now()) {
  const today = dayKey(new Date(now))
  const 오늘실행 = (state.일별 || {})[today] || 0
  const 오늘비용 = +((state.비용일별 || {})[today] || 0).toFixed(4)
  const no = (why) => ({ ok: false, why, 오늘실행, 오늘비용 })

  if (state.손상) return no(state.손상)
  if (state.차단) return no(`회로 차단됨 (${state.차단.at}): ${state.차단.이유} — 고친 뒤 --rearm 으로 푼다`)

  const 한계 = cfg.연속실패한계 ?? 3
  if ((state.연속실패 || 0) >= 한계) {
    return no(`연속 ${state.연속실패}회 실패 (한계 ${한계}) — 고친 뒤 --rearm 으로 푼다`)
  }

  const 최대 = cfg.하루최대회 ?? 12
  if (오늘실행 >= 최대) return no(`오늘 ${오늘실행}회 실행 (하루 상한 ${최대}회)`)

  const 비용상한 = cfg.하루최대비용USD
  if (typeof 비용상한 === 'number' && 오늘비용 >= 비용상한) {
    return no(`오늘 $${오늘비용} 사용 (하루 상한 $${비용상한})`)
  }

  const 간격 = cfg.최소간격분 ?? 30
  const last = state.마지막실행
  if (last && typeof last.atEpoch === 'number') {
    const 경과 = minutesSince(last.atEpoch, now)
    if (경과 < 간격) return no(`마지막 실행 ${경과}분 전 (최소 간격 ${간격}분)`)
  }

  return { ok: true, why: null, 오늘실행, 오늘비용 }
}

/** 실행 1회를 상태에 반영한다. 순수 함수 — 새 상태를 돌려준다 */
export function recordRun(state, detail, cfg = {}, now = Date.now()) {
  const { 결과, 요약, 소요초, 비용USD = 0 } = detail
  const today = dayKey(new Date(now))
  const 성공 = 결과 === 'ok'
  const 연속실패 = 성공 ? 0 : (state.연속실패 || 0) + 1
  const 한계 = cfg.연속실패한계 ?? 3
  const 이전비용 = (state.비용일별 || {})[today] || 0

  const next = {
    ...state,
    마지막실행: {
      ...detail,
      at: localStamp(new Date(now)),
      atEpoch: now,
      결과,
      요약: String(요약 ?? '').slice(0, 2000),
      소요초,
    },
    일별: { ...(state.일별 || {}), [today]: ((state.일별 || {})[today] || 0) + 1 },
    비용일별: { ...(state.비용일별 || {}), [today]: +(이전비용 + (비용USD || 0)).toFixed(4) },
    연속실패,
    차단: 연속실패 >= 한계
      ? { at: localStamp(new Date(now)), 이유: `연속 ${연속실패}회 실패` }
      : state.차단 || null,
  }
  delete next.손상 // 정상 기록에 성공했으므로 손상 표시는 지운다
  return next
}

/** 회로 차단과 연속실패를 푼다(--rearm). 순수 함수 */
export function rearm(state) {
  const next = { ...state, 연속실패: 0, 차단: null }
  delete next.손상
  return next
}

/* ── 락 (동시 실행 방지) ─────────────────────────────────────── */

/**
 * 재개는 **한 번에 하나만** 돈다. 두 개가 같은 워킹트리를 고치면 서로를 덮어쓴다.
 *
 * 프로세스가 죽어 락이 남는 경우가 있으므로 낡은 락은 회수한다.
 * PID 생존 확인(`process.kill(pid, 0)`)과 시간 한계를 **둘 다** 본다 —
 * PID 는 재사용되므로 그것만 믿을 수 없다.
 */
export function acquireLock(path, staleMin = 60) {
  /**
   * 🔴 `wx` — "없을 때만 만든다"를 운영체제가 한 동작으로 한다.
   *   보고 나서 쓰면 그 사이에 남이 끼어들어 둘 다 통과한다(lib/single.mjs 와 같은 함정).
   */
  const 만들기 = () => {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, at: localStamp(), atEpoch: Date.now() }, null, 2) + '\n',
        { flag: 'wx' })
      return true
    } catch (e) {
      if (e.code === 'EEXIST') return false
      throw e
    }
  }

  if (만들기()) return { ok: true, why: null }

  let held = null
  try { held = JSON.parse(readFileSync(path, 'utf8')) } catch { /* 깨진 락은 낡은 것으로 본다 */ }

  const ageMin = held?.atEpoch ? minutesSince(held.atEpoch) : Infinity
  let 살아있음 = false
  if (held?.pid) {
    try { process.kill(held.pid, 0); 살아있음 = true } catch { 살아있음 = false }
  }

  if (살아있음 && ageMin < staleMin) {
    return { ok: false, why: `이미 돌고 있다 (pid ${held.pid}, ${ageMin}분 전 시작)` }
  }

  // 죽은 프로세스이거나 한계를 넘겼다 — 회수하고 딱 한 번 다시 잡는다
  try { rmSync(path, { force: true }) } catch { /* 못 지우면 아래에서 실패로 답한다 */ }
  if (만들기()) return { ok: true, why: null }
  return { ok: false, why: '낡은 락을 회수하는 사이에 다른 프로세스가 잡았다' }
}

export function releaseLock(path) {
  try { rmSync(path, { force: true }) } catch { /* 이미 없으면 됐다 */ }
}
