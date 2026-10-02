/**
 * resume-report.mjs — 재개의 **부속 명령**(`--status` · `--rearm`). 판정도 실행도 하지 않는다.
 *
 * 🔴 왜 resume.mjs 에서 떼어냈나
 *   400줄 규칙을 넘겼다. 자를 자리는 여기가 맞다 — 위쪽은 "무인으로 띄울까"를 정하고
 *   여기는 **사람에게 보여주고 사람이 푸는** 일만 한다. 섞여 있으면 가드를 읽으러 온
 *   사람이 출력 서식을 함께 넘겨야 한다.
 */
import { localStamp, dayKey } from './stamp.mjs'
import { appendLine } from './io.mjs'
import { loadRunState, saveRunState, budgetVerdict, rearm } from './guard.mjs'
import { loadTargets, statePaths, resolveRepo } from './targets.mjs'
import { account } from './cli.mjs'

/** `--status` — 예산·마지막 실행 상태를 사람이 읽는 모양으로 */
export function printStatus() {
  const acct = account()
  console.log(`계정: ${acct.email || '?'} · ${acct.subscriptionType || '?'}${acct.isSubscription ? ' (구독 — 정가 환산은 청구액이 아니다)' : ''}`)
  const list = Object.entries(loadTargets().targets)
  if (!list.length) console.log('대상이 없다.')
  for (const [id, v] of list) {
    const P = statePaths(id)
    const pairCwd = v.mainCwd || v.runCwd
    const { project } = pairCwd ? resolveRepo(pairCwd) : { project: null }
    const st = loadRunState(P.resumeState)
    const b = project ? budgetVerdict(st, project.resume) : { runsToday: '?', costToday: '?', ok: false, why: '저장소 미해결' }
    const over = (st.overloadByDay || {})[dayKey()] || 0
    const auth = (st.authByDay || {})[dayKey()] || 0
    // 🔴 타임아웃도 차단하지 않는다 — 그러니 여기서 세어 말한다(일하는 중에 잘렸을 수 있다)
    const cut = (st.timeoutByDay || {})[dayKey()] || 0
    const old = (st.outdatedByDay || {})[dayKey()] || 0
    console.log(`── ${id.slice(0, 8)} ${v.title ? `· ${v.title.slice(0, 40)}` : ''}`)
    console.log(`   재시작 ${v.restart ? 'O' : 'X'} · 감시 ${v.watch ? 'O' : 'X'} · 권한 ${project?.resume.permissionMode || '-'}`)
    // 🔴 비용은 막지 않는다(통계) — 슬래시로 붙이면 상한으로 읽힌다
    console.log(`   오늘 ${b.runsToday}/${project?.resume.maxPerDay ?? '-'}회 · $${b.costToday} 씀(참고선 $${project?.resume.maxCostUSDPerDay ?? '-'})`
      + (over ? ` · 과부하로 막힘 ${over}회` : '')
      + (auth ? ` · 로그인 끊겨 헛돔 ${auth}회` : '')
      + (cut ? ` · 시간초과 ${cut}회` : '')
      + (old ? ` · 🔴 CLI낡음 ${old}회` : ''))
    console.log(`   연속실패 ${st.failStreak || 0}/${project?.resume.failStreakMax ?? '-'} · 차단 ${st.blocked ? `🔴 ${st.blocked.reason}` : '없음'}`)
    // 비용의 **출처**도 적는다 — 잘린 회차는 트랜스크립트에서 잰 값이다
    const last = st.lastRun
      ? `${st.lastRun.at} · ${st.lastRun.result} · ${st.lastRun.tookSec}초 · $${st.lastRun.costUSD ?? 0}`
        + (st.lastRun.costFrom ? ` (${st.lastRun.costFrom})` : '')
      : '없음'
    console.log(`   마지막 ${last}`)
  }
}

/**
 * `--rearm` — 회로 차단·연속실패를 푼다. 사람이 고친 뒤에 부르는 것이다.
 *
 * 🔴 실측 결함 (2026-09-22): `--session <없는id>` 를 주면 고른 대상이 0개가 되고,
 *   그러면 **전부를 푸는 쪽으로 물러섰다.** 오타 하나로 다른 세션의 회로 차단까지
 *   풀리는 것이다. 차단은 "고칠 때까지 멈춰라"는 표시인데 그것을 조용히 지운다.
 *   같은 부류를 이미 HTTP 쪽에서 고쳤다(없는 sessionId 를 400 으로 거절).
 *   **고르라고 했는데 못 골랐으면 아무것도 하지 않는다.**
 *
 * @param targets 고른 대상. 빈 배열이면 `picked` 여부로 전체/거절을 가른다.
 * @param picked  `--session` 이 주어졌는가
 * @returns {boolean} 무언가 했으면 true
 */
export function doRearm(targets, { picked = false } = {}) {
  if (picked && !targets.length) {
    console.error('✖ --session 으로 고른 대상이 없다 — 아무것도 풀지 않는다 (id 를 확인하라)')
    return false
  }
  const list = targets.length ? targets
    : Object.entries(loadTargets().targets).map(([id, v]) => ({ sessionId: id, ...v }))
  if (!list.length) { console.log('대상이 없다.'); return false }
  for (const target of list) {
    const P = statePaths(target.sessionId)
    saveRunState(P.resumeState, rearm(loadRunState(P.resumeState)))
    try { appendLine(P.resumeLogPath, `${localStamp()} · REARM · 회로 차단·연속실패 해제 (사람이 실행)`) } catch { /* 기록 실패가 해제를 막지 않는다 */ }
    console.log(`✅ ${target.sessionId.slice(0, 8)} — 회로 차단 해제`)
  }
  return true
}
