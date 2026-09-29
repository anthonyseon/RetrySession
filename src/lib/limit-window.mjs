/**
 * limit-window.mjs — **「Session (5hr)」·「Weekly (7 day)」 를 몇 %까지 왔다고 말할 수 있나.**
 *
 * 🔴 먼저 못 하는 것부터 (실측 2026-09-29)
 *   Claude Code 의 **공식 백분율은 대화 안의 `/usage` 화면에만 있다.** 헤드리스로 부르면
 *   (`claude -p /usage --output-format json`) 「What's contributing to your limits usage?」
 *   본문만 오고 막대·퍼센트가 없다. 기록에도 없다 — 트랜스크립트의 `quotaLimits` 는
 *   `{status, resetsAt, rateLimitType, overageStatus, isUsingOverage}` 뿐이고 사용률 칸이
 *   아예 없다(전수 확인). `claude auth status --json` 에도 없다.
 *   그래서 **그쪽 숫자를 그대로 옮기는 길은 없다.** 있다고 적으면 그게 거짓이 된다.
 *
 * 🔴 그래서 우리가 재고, 우리가 잰 것이라고 말한다
 *   분자: 트랜스크립트 실측 토큰(시간 통 — `lib/hours.mjs`)의 굴러가는 창 합.
 *   분모: **기준선** — 제한에 실제로 걸린 순간, 그 창은 «꽉 찬» 상태였다. 그때의 창 합이
 *        우리 단위로 본 한도다. 제한 기록(`quotaLimits._at`)이 있으면 거기서 배운다.
 *
 * 🔴 기준선이 없으면 **퍼센트를 만들지 않는다.** 그럴듯한 분모를 지어내면 「30% 남았다」가
 *   거짓이 되고, 그 숫자를 보고 일을 계획한다. 이 저장소가 늘 지켜 온 것 — 모르면 모른다고
 *   말하고 절대량만 보여준다.
 *
 * 🔴 기준선은 **아래로만 신뢰한다.** 우리 실측은 이 기계의 로컬 세션만 본다 —
 *   다른 기기·claude.ai 사용은 안 보인다. 그래서 실제로는 우리가 센 것보다 더 썼을 수 있고,
 *   퍼센트는 **최소값**으로 읽어야 한다. 화면이 그 문장을 함께 적는다.
 */
import { windowSum, HOUR_MS } from './hours.mjs'
import { localStamp } from './stamp.mjs'

/** 창의 길이 — 그쪽 이름을 그대로 쓴다(사람이 `/usage` 에서 본 말로 찾을 수 있게) */
export const WINDOWS = {
  session5h: { label: 'Session (5hr)', ms: 5 * HOUR_MS, limitType: 'five_hour' },
  weekly7d: { label: 'Weekly (7 day)', ms: 7 * 24 * HOUR_MS, limitType: 'seven_day' },
}

/**
 * 제한 기록에서 기준선을 **배운다.** 순수 함수.
 *
 * @param hours   합쳐진 시간 통
 * @param quota   가장 최근 제한 기록 (`_at` 은 관측 시각, `rateLimitType` 은 창 종류)
 * @param prev    지금까지 배워 둔 기준선 (`state/limits.json`)
 * @returns 새 기준선 (바뀐 것이 없으면 `prev` 를 그대로)
 *
 * 🔴 **가장 최근 것으로 갈아친다**(최대값을 쓰지 않는다). 요금제·모델이 바뀌면 한도도
 *   바뀌므로, 옛 최대값을 분모로 쓰면 영원히 «여유 있다» 로 보인다. 다만 옛 값도 버리지
 *   않고 `seen` 에 남긴다 — 기준선이 흔들리는지 사람이 볼 수 있어야 한다.
 */
export function learnBaseline(hours, quota, prev = {}) {
  const at = quota?._at
  const type = quota?.rateLimitType
  if (!Number.isFinite(at) || !type) return prev
  const win = Object.values(WINDOWS).find((w) => w.limitType === type)
  if (!win) return prev                       // 모르는 창 종류 — 지어내지 않는다

  const key = Object.keys(WINDOWS).find((k) => WINDOWS[k].limitType === type)
  const already = prev[key]
  if (already && already.atEpoch >= at) return prev   // 이미 그 사건으로 배웠다

  /** 제한이 난 **그 순간까지**의 창 합 = 우리 단위로 본 한도 */
  const tokens = windowSum(hours, at - win.ms, at)
  if (!(tokens > 0)) return prev              // 그 창에 우리 기록이 없다(다른 기기에서 썼다)

  return {
    ...prev,
    [key]: {
      tokens,
      atEpoch: at,
      at: localStamp(new Date(at)),
      seen: [...(already?.seen || []), ...(already ? [{ tokens: already.tokens, at: already.at }] : [])].slice(-4),
    },
  }
}

/**
 * 창 하나를 사람이 읽는 모양으로.
 *
 * @returns `{label, tokens, windowFrom, windowTo, pct|null, baseline|null, why}`
 */
export function windowView(key, hours, baseline, now = Date.now()) {
  const win = WINDOWS[key]
  const tokens = windowSum(hours, now - win.ms, now)
  const base = baseline?.[key] || null
  const pct = base?.tokens > 0 ? Math.min(999, Math.round((tokens / base.tokens) * 100)) : null
  return {
    key,
    label: win.label,
    tokens,
    windowFrom: localStamp(new Date(now - win.ms)),
    windowTo: localStamp(new Date(now)),
    pct,
    baseline: base ? { tokens: base.tokens, at: base.at } : null,
    /** 🔴 퍼센트가 없으면 **왜 없는지** 말한다. 빈칸은 고장으로 읽힌다 */
    why: pct === null
      ? `기준선이 없습니다 — ${win.label} 한도에 실제로 걸린 기록이 있어야 % 를 셀 수 있습니다(그 순간이 100% 입니다). 지금은 실측 절대량만 보여줍니다.`
      : `우리 실측(${localStamp(new Date(now - win.ms))} 이후) ÷ 기준선(${base.at} 에 제한에 걸렸을 때의 같은 창) — 다른 기기·claude.ai 사용은 안 보이므로 **최소값**입니다.`,
  }
}

/** 두 창을 한 번에 — 화면이 이 모양을 그린다 */
export const windowViews = (hours, baseline, now = Date.now()) =>
  Object.keys(WINDOWS).map((k) => windowView(k, hours, baseline, now))
