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
import { taskEntries } from './scheduler.mjs'

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
  const push = (code, level, title, desc, target) => out.push({ code, level, title, desc, target })

  /**
   * 감시가 끊겼다 — 가장 급하다. 이 도구의 존재 이유가 이것을 잡는 것이다.
   *
   * 🔴 단, **첫 기록을 기다리는 중은 끊긴 것이 아니다.**
   *   실측 사건(2026-09-21): 감시를 켠 38초 전에 하트비트가 막 지나가서, 다음
   *   회차까지 5분 동안 치명 경보가 떴다. 아무것도 고장나지 않았는데 말이다.
   *   대기는 화면의 배지가 말해준다 — 경보는 **조치가 필요할 때만** 낸다.
   *   대기 창은 한계 시간까지만이다(guard.mjs). 그 뒤엔 여기로 온다.
   */
  for (const s of d.sessions || []) {
    const v = s.watch?.verdict
    if (s.watch?.on && v && !v.alive && !v.waiting) {
      push('감시끊김', 'critical', '감시가 끊겼습니다',
        `${s.title || s.shortId} — ${v.why}`, s.sessionId)
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
  if (d.totals && d.totals.runKnown === false) {
    push('실행조회실패', 'critical', '실행 중 세션을 확인할 수 없습니다',
      `claude agents --json 이 답하지 않습니다 — ${d.totals.runQueryError || '이유 불명'}. ` +
      '세션의 실행 여부를 알 수 없고, 자율 재개는 이 상태에서 멈춥니다.')
  }

  /**
   * 🔴 로그인이 끊겼다.
   *
   *   실측 (2026-09-28, 전수 재검증): 실제 재개가 발동해
   *   `Failed to authenticate: OAuth session expired and could not be refreshed` 로
   *   실패했는데 **경보가 하나도 없었다.** 화면 머리에 "계정 확인 실패" 라는 글자만
   *   바뀐다 — 그건 눈에 띄지 않고, 목록은 트랜스크립트에서 읽으니 멀쩡히 보인다.
   *
   *   이 도구의 전제가 로그인된 계정이다(API 키를 쓰지 않는다). 그것이 없으면 재개는
   *   15분마다 조용히 실패한다. 겉은 조용하고 속은 멎은 상태 — 반드시 말해야 한다.
   */
  if (d.account && d.account.ok === false) {
    /**
     * 🔴 "끊겼다"와 "모른다"를 한 문구로 말하지 않는다 — `account()` 의 ok:false 는 둘이다.
     *   조회가 성공했는데 loggedIn:false 면 **확실히** 로그아웃이다 → 치명.
     *   조회 자체가 실패했으면(타임아웃·CLI 없음) 우리가 모르는 것이다 → 경고.
     *   20초 타임아웃 한 번에 «로그인이 끊겼습니다» 를 외치면 그건 2026-09-21 의
     *   "감시 켠 지 38초" 거짓 경보와 같은 실수다. 늑대를 외치면 진짜 늑대를 놓친다.
     */
    if (d.account.error) {
      push('계정조회실패', 'warning', '로그인 상태를 확인할 수 없습니다',
        `claude auth status 가 답하지 않습니다 — ${d.account.error}. ` +
        '정말 끊긴 것인지 조회만 실패한 것인지 알 수 없습니다. 계속 뜨면 VS Code 에서 로그인을 확인하세요.')
    } else {
      push('로그인끊김', 'critical', '로그인이 끊겼습니다',
        'claude auth status 가 «로그인되어 있지 않다»고 답합니다. ' +
        'API 키를 쓰지 않으므로 이 계정이 없으면 자율 재개가 한 번도 돌지 못합니다. VS Code 에서 다시 로그인하세요.')
    }
  }

  /* 재시작 회로 차단 */
  for (const s of d.sessions || []) {
    if (s.restart?.on && s.restart.blocked) {
      push('재시작차단', 'critical', '재시작이 차단되었습니다',
        `${s.title || s.shortId} — ${s.restart.blocked.reason} (${s.restart.blocked.at}). 상세에서 해제하세요.`, s.sessionId)
    }
    if (s.restart?.on && s.restart.corrupt) {
      push('상태손상', 'critical', '재시작 상태 파일이 깨졌습니다',
        `${s.title || s.shortId} — ${s.restart.corrupt}`, s.sessionId)
    }

    /**
     * API 과부하가 **잦다.**
     *
     * 🔴 과부하는 우리 실패가 아니라서 회로를 차단하지 않는다(그게 맞다). 그런데
     *   그러면 아무도 아무 말을 안 한다 — 재시작을 켜 뒀는데 하루 종일 한 번도
     *   못 돈 채로 조용하다. 차단은 안 하되 **말은 해야** 한다.
     *   한 번에 떠들면 거짓 경보가 된다(529 한 번은 정상 범위다). 세 번부터 말한다.
     */
    /**
     * 🔴 재개가 **로그인 때문에** 헛돌았다.
     *
     *   과부하는 세 번부터 말하지만 이것은 **한 번부터** 말한다 — 저쪽이 흔들린 것과
     *   달리 사람이 다시 로그인해야 할 수도 있고, 그동안 재개 기회는 통째로 날아간다.
     *   차단은 하지 않으므로(classify.isAuthFailure) 말하지 않으면 아무도 모른다.
     *
     *   🔴 두 조건을 **함께** 본다. `마지막 실행이 auth` 만 보면 어제 낫고 지나간 일을
     *     다음 실행이 올 때까지 계속 외친다. `오늘 몇 회` 만 보면 이미 성공으로
     *     넘어간 뒤에도 외친다. 둘을 곱해야 "지금 열려 있는 문제"만 남는다.
     */
    if (s.restart?.on && (s.restart.authToday || 0) >= 1 && s.restart.lastRun?.result === 'auth') {
      push('인증실패', 'warning', '로그인이 끊겨 재시작이 헛돌았습니다',
        `${s.title || s.shortId} — 오늘 ${s.restart.authToday}회 (마지막 ${s.restart.lastRun.at}). ` +
        '차단하지 않았으니 로그인이 살아나면 저절로 다시 돕니다. 안 풀리면 VS Code 에서 다시 로그인하세요.',
        s.sessionId)
    }

    if (s.restart?.on && (s.restart.overloadToday || 0) >= 3) {
      push('과부하잦음', 'warning', 'API 과부하로 재시작이 계속 막힙니다',
        `${s.title || s.shortId} — 오늘 ${s.restart.overloadToday}회. 저쪽 문제라 기다리면 풀립니다(차단하지 않았습니다). ` +
        'status.claude.com 을 확인하세요.', s.sessionId)
    }

    /**
     * 🔴 회차가 **타임아웃으로 잘렸다.**
     *
     *   타임아웃은 우리 실패로 세지 않는다(실측: 잘린 회차들이 kill 직전까지 일하고
     *   있었다 — guard.recordRun 의 주석). 차단하지 않는 대신 **여기서 말한다.**
     *
     *   🔴 과부하는 세 번부터지만 이것은 **두 번부터** 말한다 — 한 회차가 타임아웃분을
     *     통째로 먹고(30~60분), 그 사이 토큰도 그만큼 태운다. 실측(2026-09-28): 잘린 세
     *     회차가 90분과 성공 회차의 1.5~3배 토큰을 썼고 기록에는 $0 으로 남았다.
     *     두 번 잘렸다면 일 단위가 회차보다 큰 것이니 사람이 결정할 문제다.
     */
    if (s.restart?.on && (s.restart.timeoutToday || 0) >= 2) {
      push('타임아웃잦음', 'warning', '재시작 회차가 시간 안에 못 끝납니다',
        `${s.title || s.shortId} — 오늘 ${s.restart.timeoutToday}회 잘렸습니다. 일하는 중에 끊은 것일 수 있습니다. ` +
        'timeoutMin 을 올리거나, 재개지시를 더 작은 단위로 쪼개세요.', s.sessionId)
    }
  }

  /* OS 트리거가 없거나 실패 — 이게 없으면 세션 밖에서 아무것도 돌지 않는다 */
  for (const [key, w] of taskEntries(d.tasks)) {
    if (w.queryFailed) push('예약조회실패', 'warning', '예약 작업을 조회할 수 없습니다', `${key} — ${w.error || ''}`)
    else if (w.registered === false) {
      push('예약미등록', 'warning', '예약 작업이 등록되지 않았습니다',
        `${key} (${w.name}) — 등록하지 않으면 세션 밖에서 돌지 않습니다. start.exe -Install`)
    } else if (w.registered && !w.healthy && w.stopped) {
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
        `${key} — ${w.resultText}. 다시 띄우려면 start.exe -Restart`)
    } else if (w.registered && !w.healthy) {
      push('예약실패', 'warning', '예약 작업이 실패로 끝났습니다', `${key} — ${w.resultText || w.lastResult}`)
    }
  }

  /**
   * PC 가 잠들도록 설정돼 있다.
   *
   * 🔴 지금은 기록이 멀쩡해도 **사람이 자리를 비우는 순간 멎는다.** 감시 장치가
   *   잡아야 하는 것이 정확히 그런 것이다 — 지금 초록이라고 괜찮은 게 아니다.
   *   고칠 수 있는 항목이므로 고치는 법까지 적는다.
   */
  if (d.pc && d.pc.level === 'crit') {
    const trouble = (d.pc.items || []).filter((x) => x.level === 'crit')
    push('PC절전', 'critical', 'PC 가 잠들도록 설정돼 있습니다',
      trouble.map((x) => x.name + ' = ' + x.current).join(' · ') +
      ' — 잠들면 감시도 재개도 멎습니다. 화면의 PC 설정에서 고치거나 start.exe -Pc -Apply')
  }

  /* 사용량 제한 (지금 걸려 있을 때만) */
  const q = d.quota
  if (q?.exists && !q.alreadyLifted) {
    push('사용량제한', 'warning', '사용량 제한에 걸렸습니다', q.desc)
  }

  /* 중복 실행 — 사용자가 금지한 상태다. 생기면 알려야 한다 */
  for (const [name, l] of Object.entries(d.locks || {})) {
    if (l?.stale && l.pid) {
      push('유령락', 'info', '남은 잠금 파일이 있습니다',
        `${name} — pid ${l.pid} 가 없는데 락이 남아 있었습니다(${l.ageMin}분). 다음 실행이 회수합니다.`)
    }
  }

  /* doing 규약 위반 */
  for (const s of d.sessions || []) {
    if (s.tracker?.doingViolations) {
      push('doing위반', 'warning', '추적기에 doing 이 둘 이상입니다',
        `${s.title || s.shortId} — ${s.tracker.doingViolations.join(', ')} (규약은 한 번에 하나)`, s.sessionId)
    }
  }

  return out.sort((a, b) => levelOrder[b.level] - levelOrder[a.level])
}

/** 경보 목록을 비교 가능한 지문으로 — 같은 상태면 같은 문자열 */
export const fingerprint = (alerts) =>
  alerts.map((a) => `${a.code}:${a.target || ''}`).sort().join('|') || '(없음)'

/**
 * 바뀌었을 때만 로그에 남긴다.
 *
 * 🔴 매 회차 남기면 5분마다 같은 줄이 쌓여 이력이 쓸모없어진다. 풍선 알림이
 *   시끄러웠던 것과 같은 이유다 — 변화만 기록해야 읽을 수 있다.
 * @returns {{기록:boolean, 이전:string|null, 지금:string}}
 */
export function changeLog(alerts) {
  const nowMs = fingerprint(alerts)
  let prev = null
  try { prev = JSON.parse(readFileSync(lastFile(), 'utf8')).fingerprint ?? null } catch { prev = null }

  if (prev === nowMs) return { record: false, prev, nowMs }

  const at = localStamp()
  const line = alerts.length
    ? alerts.map((a) => `${at} · ${a.level.toUpperCase()} · ${a.code} · ${a.title} — ${a.desc}`).join('\n')
    : `${at} · OK · 해소 · 살아 있는 경보가 없습니다`

  try { appendLine(alertLog(), line) } catch { /* 로그 실패로 감시를 막지 않는다 */ }
  try {
    // 지문이 찢어지면 다음 회차가 "바뀌었다"고 오판해 같은 경보를 다시 적는다
    writeJsonAtomic(lastFile(), { fingerprint: nowMs, at, count: alerts.length })
  } catch { /* 위와 같다 */ }

  return { record: true, prev, nowMs }
}

/** 경보 로그 꼬리 — 화면의 "알림" 탭이 읽는다 */
export function recentAlerts(n = 60) {
  const p = alertLog()
  if (!existsSync(p)) return []
  try {
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-n).reverse()
  } catch { return [] }
}
