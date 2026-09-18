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

/* ── 하트비트 낡음 판정 ───────────────────────────────────────── */

/**
 * 하트비트 기록이 살아 있는가. 순수 함수 — 객체를 받아 판정만 한다.
 * @param hb 하트비트 JSON 객체. 읽기 실패면 null 을 넘긴다.
 */
export function heartbeatVerdict(hb, limitMin = 15, now = Date.now()) {
  if (hb === null || typeof hb !== 'object') {
    return { alive: false, ageMin: null, why: '하트비트 파일을 읽을 수 없다' }
  }
  if (typeof hb.atEpoch !== 'number') {
    return { alive: false, ageMin: null, why: 'atEpoch 필드가 없다(구 버전이 쓴 파일) — 낡음을 판정할 수 없다' }
  }
  const ageMin = Math.round(minutesSince(hb.atEpoch, now))
  if (ageMin > limitMin) return { alive: false, ageMin, why: `마지막 기록이 ${ageMin}분 전 (한계 ${limitMin}분)` }
  if (ageMin < -5) return { alive: false, ageMin, why: `마지막 기록이 미래다(${ageMin}분) — 시계가 어긋났다` }
  return { alive: true, ageMin, why: null }
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

export function saveRunState(path, state) {
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n')
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
  if (existsSync(path)) {
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
    // 여기까지 오면 회수한다 — 죽은 프로세스이거나 한계를 넘겼다
  }

  writeFileSync(path, JSON.stringify({ pid: process.pid, at: localStamp(), atEpoch: Date.now() }, null, 2) + '\n')
  return { ok: true, why: null }
}

export function releaseLock(path) {
  try { rmSync(path, { force: true }) } catch { /* 이미 없으면 됐다 */ }
}
