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
import { writeJsonAtomic } from './io.mjs'

/* ── 하트비트 낡음 판정 ───────────────────────────────────────── */

/**
 * 하트비트 기록이 살아 있는가. 순수 함수 — 객체를 받아 판정만 한다.
 * @param hb 하트비트 JSON 객체. 읽기 실패면 null 을 넘긴다.
 */
export function heartbeatVerdict(hb, limitMin = 15, now = Date.now(), onEpoch = null) {
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
    if (typeof onEpoch === 'number' && Number.isFinite(onEpoch)) {
      const sinceOn = minutesSince(onEpoch, now)
      if (sinceOn <= limitMin) {
        return {
          alive: false, 대기: true, ageMin: null,
          why: `감시를 켠 지 ${Math.max(0, Math.round(sinceOn))}분 — 첫 기록을 기다리는 중 (5분마다 기록한다)`,
        }
      }
      return {
        alive: false, 대기: false, ageMin: null,
        why: `감시를 켠 지 ${Math.round(sinceOn)}분이 지났는데 첫 기록이 없다 (한계 ${limitMin}분) — 하트비트가 돌지 않는다`,
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
export function sessionRunning(목록, sessionId, isAlive = () => true) {
  if (!목록 || 목록.ok !== true) {
    return {
      실행중: true, isCertain: false,
      why: `실행 중 여부를 확인할 수 없다 — ${목록?.오류 || '목록을 받지 못했다'}. 모르는 채로 밀면 사람이 쓰는 대화에 끼어든다`,
    }
  }
  const s = (목록.sessions || []).find((x) => x.sessionId === sessionId)
  if (!s) return { 실행중: false, isCertain: true, why: null }
  if (!isAlive(s.pid)) return { 실행중: false, isCertain: true, why: null }
  return { 실행중: true, isCertain: true, why: `세션이 실행 중이다 (pid ${s.pid}) — 사람이 쓰는 중이므로 건드리지 않는다` }
}

/* ── 사용량 제한 ─────────────────────────────────────────────── */

/**
 * 지금 사용량 제한에 걸려 있는가. 순수 함수.
 *
 * 🔴 왜 재개가 이것을 봐야 하나
 *   제한 중에 `claude --resume` 을 띄우면 그냥 실패한다. 그리고 실패 3회면
 *   회로가 차단된다 — **제한이 차단기를 태운다.** 기다려야 할 일이 고장으로 기록되고,
 *   제한이 풀린 뒤에도 사람이 `--rearm` 을 해줄 때까지 재개가 멎는다.
 *   제한은 고장이 아니라 **때가 아닌 것**이다. 때가 되면 저절로 풀린다.
 *
 * 🔴 "모르면 막는다"를 여기서는 쓰지 않는다.
 *   할당량 기록은 **마지막으로 제한에 걸렸을 때** 남은 것이고, 새 제한에 걸리기
 *   전까지 그대로 남아 있다. 해제 시각을 모른다고 막으면 그 기록 때문에 재개가
 *   영원히 멎는다 — 끝이 없는 차단은 fail-open 만큼 나쁘다.
 *   그래서 **확실히 제한 중일 때만** 막고, 나머지는 통과시킨다.
 *   놓친 경우는 실행 결과가 받아낸다(제한실패인가 → 연속실패로 세지 않는다).
 *
 * @param 할당량 트랜스크립트에서 읽은 quotaLimits (resetsAt 은 **초** 단위)
 */
export function limitState(할당량, now = Date.now()) {
  const none = { limited: false, lifted: false, leftMin: null, liftedEpoch: null, why: null }
  if (!할당량 || typeof 할당량 !== 'object') return none

  const resetsAt = 할당량.resetsAt
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) {
    return { ...none, why: null, unknown: true }
  }

  const liftedEpoch = resetsAt * 1000
  const leftMin = Math.ceil((liftedEpoch - now) / 60000)
  if (leftMin > 0) {
    return {
      limited: true, lifted: false, leftMin, liftedEpoch,
      why: `사용량 제한 중 (${할당량.rateLimitType || '?'}) — ${leftMin}분 후 해제. 제한 중에 띄우면 실패로 기록돼 회로를 태운다`,
    }
  }
  return { limited: false, lifted: true, leftMin, liftedEpoch, why: null }
}

/**
 * 이번 실행이 **사용량 제한 때문에** 실패했는가. 순수 함수.
 *
 * 제한 전 확인을 통과했더라도(기록이 낡았거나 방금 걸렸거나) 실제로는 막힐 수 있다.
 * 그때 이것을 실패로 세면 세 번 만에 회로가 차단된다 — 기다리면 될 일에.
 * 🔴 모르면 실패로 센다(false) — 진짜 고장을 제한으로 감추면 안 된다.
 */
export function isLimitFailure(글) {
  const s = String(글 || '')
  if (!s) return false
  return /limit/i.test(s) && /(usage|rate|quota|reset|weekly|session limit)/i.test(s)
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

export const emptyState = () => ({ 마지막실행: null, 일별: {}, costByDay: {}, 연속실패: 0, 차단: null })

/**
 * 실행 상태를 읽는다.
 * 파일이 **없으면** 첫 실행이므로 빈 상태(허용). 파일이 **깨졌으면** 몇 번 돌았는지
 * 알 수 없으므로 fail-closed — `손상:true` 로 표시해 호출부가 막는다.
 */
export function loadRunState(path) {
  if (!existsSync(path)) return emptyState()
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'))
    return { ...emptyState(), ...s }
  } catch (e) {
    return { ...emptyState(), 손상: `실행 상태 파일이 깨졌다: ${e.message}` }
  }
}

/**
 * 🔴 원자적으로 쓴다. 이 파일이 찢어지면 loadRunState 가 `손상` 을 달고,
 *   budgetVerdict 가 그걸 보고 재개를 막는다 — 고쳐줄 사람이 올 때까지.
 *   쓰다 죽었다는 이유로 자율 재개가 멈추면 안 된다.
 */
export function saveRunState(path, state) {
  writeJsonAtomic(path, state)
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
  const 오늘비용 = +((state.costByDay || {})[today] || 0).toFixed(4)
  const no = (why) => ({ ok: false, why, 오늘실행, 오늘비용 })

  if (state.손상) return no(state.손상)
  if (state.차단) return no(`회로 차단됨 (${state.차단.at}): ${state.차단.이유} — 고친 뒤 --rearm 으로 푼다`)

  const limit = cfg.연속실패한계 ?? 3
  if ((state.연속실패 || 0) >= limit) {
    return no(`연속 ${state.연속실패}회 실패 (한계 ${limit}) — 고친 뒤 --rearm 으로 푼다`)
  }

  const max = cfg.하루최대회 ?? 12
  if (오늘실행 >= max) return no(`오늘 ${오늘실행}회 실행 (하루 상한 ${max}회)`)

  const costCap = cfg.하루최대비용USD
  if (typeof costCap === 'number' && 오늘비용 >= costCap) {
    return no(`오늘 $${오늘비용} 사용 (하루 상한 $${costCap})`)
  }

  const interval = cfg.최소간격분 ?? 30
  const last = state.마지막실행
  if (last && typeof last.atEpoch === 'number') {
    const elapsed = minutesSince(last.atEpoch, now)
    if (elapsed < interval) return no(`마지막 실행 ${elapsed}분 전 (최소 간격 ${interval}분)`)
  }

  return { ok: true, why: null, 오늘실행, 오늘비용 }
}

/** 실행 1회를 상태에 반영한다. 순수 함수 — 새 상태를 돌려준다 */
export function recordRun(state, detail, cfg = {}, now = Date.now()) {
  const { 결과, summary, tookSec, 비용USD = 0 } = detail
  const today = dayKey(new Date(now))
  const okCount = 결과 === 'ok'

  /**
   * 🔴 제한은 실패가 아니다 — 연속실패를 올리지 않는다.
   *   제한 중에 띄운 회차를 실패로 세면 세 번 만에 회로가 차단되고, 제한이 풀린
   *   뒤에도 사람이 --rearm 을 해줄 때까지 재개가 멎는다. 기다리면 될 일이었다.
   *   그렇다고 성공도 아니다 — 연속실패를 **0 으로 되돌리지도 않는다.**
   *   진짜 실패 두 번 뒤에 제한 한 번이 끼어도 그 두 번은 그대로 남아야 한다.
   *   하루 횟수에는 센다(프로세스를 띄웠으니 시도는 시도다).
   */
  const limitInfo = 결과 === '제한'
  const 연속실패 = okCount ? 0 : limitInfo ? (state.연속실패 || 0) : (state.연속실패 || 0) + 1
  const limit = cfg.연속실패한계 ?? 3
  const prevCost = (state.costByDay || {})[today] || 0

  const next = {
    ...state,
    마지막실행: {
      ...detail,
      at: localStamp(new Date(now)),
      atEpoch: now,
      결과,
      summary: String(summary ?? '').slice(0, 2000),
      tookSec,
    },
    일별: { ...(state.일별 || {}), [today]: ((state.일별 || {})[today] || 0) + 1 },
    costByDay: { ...(state.costByDay || {}), [today]: +(prevCost + (비용USD || 0)).toFixed(4) },
    연속실패,
    차단: 연속실패 >= limit
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
  const make = () => {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, at: localStamp(), atEpoch: Date.now() }, null, 2) + '\n',
        { flag: 'wx' })
      return true
    } catch (e) {
      if (e.code === 'EEXIST') return false
      throw e
    }
  }

  if (make()) return { ok: true, why: null }

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
  if (make()) return { ok: true, why: null }
  return { ok: false, why: '낡은 락을 회수하는 사이에 다른 프로세스가 잡았다' }
}

export function releaseLock(path) {
  try { rmSync(path, { force: true }) } catch { /* 이미 없으면 됐다 */ }
}
