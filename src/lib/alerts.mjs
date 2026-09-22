/**
 * alerts.mjs — 무엇이 잘못됐는지 한 곳에서 판정하고, 바뀔 때만 기록한다.
 *
 * 왜 Windows 풍선 알림을 걷어냈나
 *   트레이가 상태 변화마다 풍선을 띄웠는데 너무 자주 떴다. 상태가 조금만 오르내려도
 *   (서버 재시작 한 번에도) 알림이 나가고, 그렇게 잦아지면 **진짜 경고가 묻힌다.**
 *   알림은 화면에서 본다. 트레이는 색과 툴팁으로 상태만 나른다.
 *
 * 그래서 이력이 필요하다
 *   화면을 닫아둔 사이에 생긴 일을 놓치면 안 된다. 하트비트(5분마다)가 경보를
 *   판정해 **바뀔 때만** state/alerts.log 에 한 줄 남긴다. 화면은 현재 경보와
 *   그 이력을 함께 보여준다.
 *
 * 🔴 판정은 여기 하나다. 화면·트레이·로그가 제각기 판단하면 서로 다른 말을 한다.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME } from './config.mjs'
import { localStamp } from './stamp.mjs'
import { writeJsonAtomic, appendLine } from './io.mjs'

const stateDir = () => { const d = join(RS_HOME, 'state'); mkdirSync(d, { recursive: true }); return d }
export const alertLog = () => join(stateDir(), 'alerts.log')
const lastFile = () => join(stateDir(), 'alerts-last.json')

/** 수준 — 화면이 색과 아이콘을 고르는 기준 */
export const levelOrder = { critical: 3, warning: 2, info: 1 }

/**
 * 지금 살아 있는 경보. 순수 함수 — fullStatus() 결과만 보고 판정한다.
 * @returns {Array<{코드:string, 수준:'critical'|'warning'|'info', 제목:string, 설명:string, 대상?:string}>}
 */
export function currentAlerts(d) {
  const out = []
  if (!d) return out
  const push = (코드, 수준, 제목, 설명, 대상) => out.push({ 코드, 수준, 제목, 설명, 대상 })

  /**
   * 감시가 끊겼다 — 가장 급하다. 이 도구의 존재 이유가 이것을 잡는 것이다.
   *
   * 🔴 단, **첫 기록을 기다리는 중은 끊긴 것이 아니다.**
   *   실측 사건(2026-09-21): 감시를 켠 38초 전에 하트비트가 막 지나가서, 다음
   *   회차까지 5분 동안 치명 경보가 떴다. 아무것도 고장나지 않았는데 말이다.
   *   대기는 화면의 배지가 말해준다 — 경보는 **조치가 필요할 때만** 낸다.
   *   대기 창은 한계 시간까지만이다(guard.mjs). 그 뒤엔 여기로 온다.
   */
  for (const s of d.세션 || []) {
    const v = s.감시?.verdict
    if (s.감시?.켜짐 && v && !v.alive && !v.대기) {
      push('감시끊김', 'critical', '감시가 끊겼습니다',
        `${s.제목 || s.짧은id} — ${v.why}`, s.sessionId)
    }
  }

  /**
   * 🔴 실행 중 세션을 확인할 수 없다.
   *
   *   이게 경보인 이유: 이 조회가 실패하면 화면·기록·트레이가 모두 세션을 "정지"로
   *   보여준다(실행여부앎 이 없던 시절엔 그것조차 구별 못 했다). 그리고 자율 재개는
   *   이 값을 관문으로 쓰므로 **재개가 통째로 멈춘다**(fail-closed 라 그게 맞다).
   *   즉 겉으로는 조용한데 실제로는 감시도 재개도 못 하는 상태다 —
   *   이 도구가 막으라고 있는 바로 그 상황이라 반드시 말해야 한다.
   */
  if (d.합계 && d.합계.실행여부앎 === false) {
    push('실행조회실패', 'critical', '실행 중 세션을 확인할 수 없습니다',
      `claude agents --json 이 답하지 않습니다 — ${d.합계.실행여부오류 || '이유 불명'}. ` +
      '세션의 실행 여부를 알 수 없고, 자율 재개는 이 상태에서 멈춥니다.')
  }

  /* 재시작 회로 차단 */
  for (const s of d.세션 || []) {
    if (s.재시작?.켜짐 && s.재시작.차단) {
      push('재시작차단', 'critical', '재시작이 차단되었습니다',
        `${s.제목 || s.짧은id} — ${s.재시작.차단.이유} (${s.재시작.차단.at}). 상세에서 해제하세요.`, s.sessionId)
    }
    if (s.재시작?.켜짐 && s.재시작.손상) {
      push('상태손상', 'critical', '재시작 상태 파일이 깨졌습니다',
        `${s.제목 || s.짧은id} — ${s.재시작.손상}`, s.sessionId)
    }
  }

  /* OS 트리거가 없거나 실패 — 이게 없으면 세션 밖에서 아무것도 돌지 않는다 */
  for (const [키, w] of Object.entries(d.작업 || {})) {
    if (키 === '캐시됨' || !w || typeof w !== 'object') continue
    if (w.queryFailed) push('예약조회실패', 'warning', '예약 작업을 조회할 수 없습니다', `${키} — ${w.오류 || ''}`)
    else if (w.등록됨 === false) {
      push('예약미등록', 'warning', '예약 작업이 등록되지 않았습니다',
        `${키} (${w.이름}) — 등록하지 않으면 세션 밖에서 돌지 않습니다. start.exe -Install`)
    } else if (w.등록됨 && !w.정상 && w.중지됨) {
      /**
       * 🔴 멈춘 것과 고장 난 것을 같은 문구로 말하지 않는다. 대처가 다르다.
       *   실측(2026-09-21): `start.ps1 -Restart` 가 Stop-Process -Force 로 끊으면
       *   종료 코드가 -1(=4294967295)로 남는데, 이걸 "실패"라고 불러서
       *   **자기 자신의 정상 절차를 고장으로 보고**했다. 스킬은 코드를 고칠 때마다
       *   -Restart 를 시키므로 개발 주기마다 이 거짓 경보가 떴다.
       *   지금 돌고 있으면 아예 경보가 아니고(scheduler.mjs 의 정상 판정),
       *   정말 멈춰 있을 때만 "멈춰 있다"고 — 되살리는 법과 함께 — 말한다.
       */
      push('예약중지', 'warning', '예약 작업이 멈춰 있습니다',
        `${키} — ${w.resultText}. 다시 띄우려면 start.exe -Restart`)
    } else if (w.등록됨 && !w.정상) {
      push('예약실패', 'warning', '예약 작업이 실패로 끝났습니다', `${키} — ${w.resultText || w.마지막결과}`)
    }
  }

  /**
   * PC 가 잠들도록 설정돼 있다.
   *
   * 🔴 지금은 기록이 멀쩡해도 **사람이 자리를 비우는 순간 멎는다.** 감시 장치가
   *   잡아야 하는 것이 정확히 그런 것이다 — 지금 초록이라고 괜찮은 게 아니다.
   *   고칠 수 있는 항목이므로 고치는 법까지 적는다.
   */
  if (d.pc && d.pc.수준 === 'crit') {
    const trouble = (d.pc.목록 || []).filter((x) => x.수준 === 'crit')
    push('PC절전', 'critical', 'PC 가 잠들도록 설정돼 있습니다',
      trouble.map((x) => x.이름 + ' = ' + x.현재).join(' · ') +
      ' — 잠들면 감시도 재개도 멎습니다. 화면의 PC 설정에서 고치거나 start.exe -Pc -Apply')
  }

  /* 사용량 제한 (지금 걸려 있을 때만) */
  const q = d.할당량
  if (q?.있음 && !q.이미해제됨) {
    push('사용량제한', 'warning', '사용량 제한에 걸렸습니다', q.설명)
  }

  /* 중복 실행 — 사용자가 금지한 상태다. 생기면 알려야 한다 */
  for (const [이름, l] of Object.entries(d.락 || {})) {
    if (l?.낡음 && l.pid) {
      push('유령락', 'info', '남은 잠금 파일이 있습니다',
        `${이름} — pid ${l.pid} 가 없는데 락이 남아 있었습니다(${l.나이분}분). 다음 실행이 회수합니다.`)
    }
  }

  /* doing 규약 위반 */
  for (const s of d.세션 || []) {
    if (s.추적기?.doing위반) {
      push('doing위반', 'warning', '추적기에 doing 이 둘 이상입니다',
        `${s.제목 || s.짧은id} — ${s.추적기.doing위반.join(', ')} (규약은 한 번에 하나)`, s.sessionId)
    }
  }

  return out.sort((a, b) => levelOrder[b.수준] - levelOrder[a.수준])
}

/** 경보 목록을 비교 가능한 지문으로 — 같은 상태면 같은 문자열 */
export const 지문 = (alerts) =>
  alerts.map((a) => `${a.코드}:${a.대상 || ''}`).sort().join('|') || '(없음)'

/**
 * 바뀌었을 때만 로그에 남긴다.
 *
 * 🔴 매 회차 남기면 5분마다 같은 줄이 쌓여 이력이 쓸모없어진다. 풍선 알림이
 *   시끄러웠던 것과 같은 이유다 — 변화만 기록해야 읽을 수 있다.
 * @returns {{기록:boolean, 이전:string|null, 지금:string}}
 */
export function changeLog(alerts) {
  const nowMs = 지문(alerts)
  let 이전 = null
  try { 이전 = JSON.parse(readFileSync(lastFile(), 'utf8')).지문 ?? null } catch { 이전 = null }

  if (이전 === nowMs) return { record: false, 이전, nowMs }

  const at = localStamp()
  const line = alerts.length
    ? alerts.map((a) => `${at} · ${a.수준.toUpperCase()} · ${a.코드} · ${a.제목} — ${a.설명}`).join('\n')
    : `${at} · OK · 해소 · 살아 있는 경보가 없습니다`

  try { appendLine(alertLog(), line) } catch { /* 로그 실패로 감시를 막지 않는다 */ }
  try {
    // 지문이 찢어지면 다음 회차가 "바뀌었다"고 오판해 같은 경보를 다시 적는다
    writeJsonAtomic(lastFile(), { 지문: nowMs, at, 개수: alerts.length })
  } catch { /* 위와 같다 */ }

  return { record: true, 이전, nowMs }
}

/** 경보 로그 꼬리 — 화면의 "알림" 탭이 읽는다 */
export function recentAlerts(n = 60) {
  const p = alertLog()
  if (!existsSync(p)) return []
  try {
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-n).reverse()
  } catch { return [] }
}
