/**
 * limit-window.mjs — 창(5시간 · 7일)의 **우리 실측 몫**. 백분율은 여기서 만들지 않는다.
 *
 * 🔴 왜 백분율을 뺐나 (사용자 지적 2026-09-29)
 *   예전에는 «실측 ÷ 제한 사건에서 배운 기준선» 으로 퍼센트를 만들었다. **틀렸다.**
 *   사용자가 대화 안 `/usage` 에서 본 값은 `Session 7% · Weekly 40%` 인데 화면은 100% 를
 *   보여줬다. 한도의 단위도, 창이 언제 시작하는지도 우리가 모르므로 추정으로는 맞출 수 없다.
 *   지금은 **공식 값을 그쪽에서 받아 온다**(`lib/oauth-usage.mjs`).
 *
 *   그래도 실측 토큰은 남긴다 — 「그 창에서 우리가 실제로 얼마나 태웠나」는 공식 퍼센트가
 *   말해주지 않는 사실이고(토큰·모델별 몫), 우리가 유일하게 아는 값이다.
 *   🔴 다만 이 값과 공식 퍼센트를 **나누지 않는다.** 단위가 다른 둘을 나누면 그게 추정이다.
 */
import { windowSum, HOUR_MS } from './hours.mjs'
import { localStamp } from './stamp.mjs'

/** 창 길이 — 이름은 대화 안 `/usage` 화면의 말 그대로 쓴다 */
export const WINDOWS = {
  session5h: { label: 'Session (5hr)', ms: 5 * HOUR_MS },
  weekly7d: { label: 'Weekly (7 day)', ms: 7 * 24 * HOUR_MS },
}

/**
 * 창마다 **우리가 실측한 토큰**. 순수 함수.
 *
 * 🔴 굴러가는 창이다(지금부터 거꾸로). 공식 창은 시작·초기화 시각이 정해져 있어서
 *   경계가 우리와 다를 수 있다 — 그래서 화면이 이 값을 «참고» 로 적고 퍼센트로 쓰지 않는다.
 */
export function measuredWindows(hours, now = Date.now()) {
  return Object.entries(WINDOWS).map(([key, win]) => ({
    key,
    label: win.label,
    tokens: windowSum(hours, now - win.ms, now),
    windowFrom: localStamp(new Date(now - win.ms)),
    windowTo: localStamp(new Date(now)),
  }))
}

/**
 * 공식 창(퍼센트·초기화 시각)과 우리 실측 창(토큰)을 **한 줄로 묶는다.**
 *
 * 🔴 공식 값이 없으면 퍼센트 칸을 `null` 로 둔다 — 실측으로 메우지 않는다.
 *   빈칸에 그럴듯한 숫자를 넣는 것이 이 화면에서 가장 나쁜 짓이다(그래서 한 번 고쳤다).
 */
export function joinWindows(official = [], hours = {}, now = Date.now()) {
  const mine = new Map(measuredWindows(hours, now).map((m) => [m.key, m]))
  const keys = [...new Set([...official.map((o) => o.key), ...mine.keys()])]
  return keys.map((key) => {
    const o = official.find((x) => x.key === key) || null
    const m = mine.get(key) || null
    return {
      key,
      label: o?.label || m?.label || key,
      /** 🔴 공식 값 그대로. 없으면 null — 화면이 «받지 못했다» 고 말한다 */
      pct: o ? o.pct : null,
      resetsAt: o?.resetsAt || null,
      resetsInMin: o?.resetsInMin ?? null,
      severity: o?.severity || null,
      lockedReason: o?.lockedReason || null,
      /** 우리 실측(굴러가는 창) — 참고값이다. 퍼센트의 분자가 아니다 */
      measured: m ? { tokens: m.tokens, windowFrom: m.windowFrom, windowTo: m.windowTo } : null,
    }
  })
}
