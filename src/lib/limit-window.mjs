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
 * @param hours       합쳐진 시간 통
 * @param quotaByType **창 종류별** 마지막 제한 기록 `{ five_hour: {_at, rateLimitType}, … }`
 * @param prev        지금까지 배워 둔 기준선 (`state/limits.json`)
 * @returns 새 기준선 (바뀐 것이 없으면 `prev` 를 그대로)
 *
 * 🔴 **종류별로 받는다** (실측 결함 2026-09-29). 예전에는 «가장 최근 한 건» 만 받았다.
 *   이 기계의 기록은 `five_hour` 172건 · `seven_day` 7건이었는데, 최근 것이 늘 five_hour
 *   라서 seven_day 사건이 통째로 가려졌다 — 그래서 주간 사용률이 영원히 「기준선 없음」이었다.
 *   한 종류의 새 사건이 **다른 종류의 배움을 지우면 안 된다.**
 *
 * 🔴 **가장 최근 것으로 갈아친다**(최대값을 쓰지 않는다). 요금제·모델이 바뀌면 한도도
 *   바뀌므로, 옛 최대값을 분모로 쓰면 영원히 «여유 있다» 로 보인다. 다만 옛 값도 버리지
 *   않고 `seen` 에 남긴다 — 기준선이 흔들리는지 사람이 볼 수 있어야 한다.
 */
export function learnBaseline(hours, quotaByType, prev = {}) {
  let next = prev
  for (const [key, win] of Object.entries(WINDOWS)) {
    const q = quotaByType?.[win.limitType]
    const at = q?._at
    if (!Number.isFinite(at)) continue        // 그 종류로 걸린 기록이 없다 — 지어내지 않는다

    const already = next[key]
    if (already && already.atEpoch >= at) continue     // 이미 그 사건으로 배웠다

    /** 제한이 난 **그 순간까지**의 창 합 = 우리 단위로 본 한도 */
    const tokens = windowSum(hours, at - win.ms, at)
    // 🔴 그 창에 우리 기록이 없으면 배우지 않는다 — 다른 기기에서 썼거나 통이 밀려 나갔다
    if (!(tokens > 0)) continue

    next = { ...next, [key]: stamp(tokens, at, 'limit', already) }
  }
  return next
}

/** 기준선 한 칸 — 값·시각·**어디서 얻었나**. 출처가 없으면 그 숫자를 의심할 수 없다 */
const stamp = (tokens, atEpoch, source, already) => ({
  tokens,
  atEpoch,
  at: localStamp(new Date(atEpoch)),
  /** `limit` = 제한에 걸린 창(그 순간이 한도) · `survived` = 제한 없이 넘긴 최대 창(한도는 더 높다) */
  source,
  seen: [...(already?.seen || []), ...(already ? [{ tokens: already.tokens, at: already.at, source: already.source }] : [])].slice(-4),
})

/**
 * 🔴 **관측과 어긋나는 기준선을 스스로 고친다** (실측 결함 2026-09-29).
 *
 *   주간 기준선을 2026-09-18 사건에서 배운 뒤 화면에 **215%** 가 떴다. 그런데 그때 우리는
 *   주간 제한에 걸려 있지 **않았다** — 즉 「그 창을 넘겼는데 멀쩡하다」는 관측이 있고,
 *   그것은 기준선이 틀렸다는 증거다(사용량이 그 뒤로 늘었거나, 그때 우리가 본 세션이
 *   계정 전체보다 적었다). 틀린 분모로 만든 215% 를 그대로 보여주면 사람이 그 숫자로
 *   판단한다 — 감시 장치가 할 수 있는 가장 나쁜 일이다.
 *
 *   증거는 두 방향으로 온다:
 *     · 제한에 걸렸다      → 한도 ≈ 그때의 창    (`source: 'limit'`)
 *     · 걸리지 않고 넘겼다  → 한도 ≥ 지금의 창    (`source: 'survived'`)
 *   그래서 넘겼다면 기준선을 **지금의 창까지 올린다.** 그러면 백분율은 «우리가 증거로
 *   가진 가장 큰 창 대비» 가 되고, 100% 를 넘는 거짓말이 사라진다. 화면은 출처를 함께 적어
 *   「한도는 더 높을 수 있다」를 말한다.
 *
 * @param limitedNow `{ five_hour: true|false, … }` — 지금 그 종류로 제한 중인가
 */
export function reconcileBaseline(hours, baseline, limitedNow = {}, now = Date.now()) {
  let next = baseline || {}
  for (const [key, win] of Object.entries(WINDOWS)) {
    const base = next[key]
    if (!base?.tokens) continue
    const cur = windowSum(hours, now - win.ms, now)
    if (cur <= base.tokens) continue
    // 지금 그 종류로 막혀 있다면 넘긴 것이 아니다 — 기준선이 맞고 창이 꽉 찬 것이다
    if (limitedNow[win.limitType]) continue
    next = { ...next, [key]: stamp(cur, now, 'survived', base) }
  }
  return next
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
  /** 기준선이 어디서 왔는지 — 이 한 단어가 백분율의 뜻을 바꾼다 */
  const from = base?.source === 'survived' ? '제한 없이 넘긴 최대 창' : '제한에 걸린 창'
  return {
    key,
    label: win.label,
    tokens,
    windowFrom: localStamp(new Date(now - win.ms)),
    windowTo: localStamp(new Date(now)),
    pct,
    baseline: base ? { tokens: base.tokens, at: base.at, source: base.source || 'limit', from } : null,
    /** 🔴 퍼센트가 없으면 **왜 없는지** 말한다. 빈칸은 고장으로 읽힌다 */
    why: pct === null
      ? `기준선이 없습니다 — ${win.label} 한도에 실제로 걸린 기록이 있어야 % 를 셀 수 있습니다(그 순간이 100% 입니다). 지금은 실측 절대량만 보여줍니다.`
      : base.source === 'survived'
        ? `기준선은 ${base.at} 까지 **제한 없이 넘긴 가장 큰 창**입니다 — 한도는 그보다 높습니다(얼마나 높은지는 알 수 없습니다). 그러니 이 값은 «우리가 증거로 가진 최대치 대비» 이고, 100% 라도 한도에 닿았다는 뜻이 아닙니다.`
        : `우리 실측(${localStamp(new Date(now - win.ms))} 이후) ÷ 기준선(${base.at} 에 제한에 걸렸을 때의 같은 창) — 다른 기기·claude.ai 사용은 안 보이므로 **최소값**입니다.`,
  }
}

/** 두 창을 한 번에 — 화면이 이 모양을 그린다 */
export const windowViews = (hours, baseline, now = Date.now()) =>
  Object.keys(WINDOWS).map((k) => windowView(k, hours, baseline, now))
