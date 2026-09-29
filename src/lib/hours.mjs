/**
 * hours.mjs — **굴러가는 창**(5시간 · 7일)을 재기 위한 시간 통. 순수 함수만.
 *
 * 🔴 왜 날짜 통으로는 안 되나
 *   「Session (5hr)」 은 지금부터 5시간 전까지이고 「Weekly (7 day)」 는 7일 전까지다.
 *   둘 다 **자정과 무관**하므로 날짜 통(`dayByModel`)으로는 답이 나오지 않는다.
 *
 * 🔴 왜 그때그때 훑지 않나
 *   7일 창을 엔트리로 재려면 트랜스크립트를 거의 전부 읽어야 한다(실측: 한 세션이 47MB).
 *   시간 통은 증분 접기에 그대로 얹히고, 통이 8일치뿐이라 캐시도 거의 안 자란다.
 *
 * 🔴 왜 session-fold 에서 갈랐나 — 그 파일이 432줄이 됐다(규칙 400). 「굴러가는 창」은
 *   한 관심사다. 여기는 **토큰 수만** 다룬다(모델·단가는 모른다) — 그래서 순수하고 싸다.
 */

/** 한 통의 길이. 5시간·7일 창을 재는 데 시간 단위면 충분하다(오차 최대 1시간) */
export const HOUR_MS = 3600_000
/** 보관 기간 — 7일 창 + 여유 하루. 그 이상은 아무도 묻지 않는다 */
const KEEP_HOURS = 8 * 24

/** 통의 이름은 **시각을 시간으로 내린 epoch** 다 — 숫자라 비교·정렬이 그대로 된다 */
export const hourKey = (ts) => Math.floor(ts / HOUR_MS) * HOUR_MS

/**
 * 시간 통에 더하고, 오래된 통을 버린다.
 *
 * 🔴 버리는 기준은 **통에 든 가장 늦은 시각**이다(`Date.now()` 가 아니다). 옛 트랜스크립트를
 *   처음 접을 때 now 를 기준으로 버리면 그 세션의 통이 통째로 사라진다 — 지난 기록도
 *   기준선을 배우는 데 쓰므로 버리면 안 된다.
 */
export function putHour(acc, ts, tokens) {
  if (!acc.hours) acc.hours = {}
  if (!Number.isFinite(ts) || !(tokens > 0)) return acc.hours
  const k = hourKey(ts)
  acc.hours[k] = (acc.hours[k] || 0) + tokens
  const keys = Object.keys(acc.hours).map(Number)
  const floor = Math.max(...keys) - KEEP_HOURS * HOUR_MS
  for (const key of keys) if (key < floor) delete acc.hours[key]
  return acc.hours
}

/**
 * `[from, to)` 구간의 토큰 합. **순수 함수.**
 *
 * 🔴 통은 한 시간 단위라 경계가 한 시간 안에서 뭉툭하다. 통의 **시작 시각**이 구간에
 *   들어오면 센다 — 창을 넓게 잡는 쪽이다. 사용량을 적게 보이게 하는 쪽으로 기울면
 *   「아직 여유가 있다」는 거짓을 만든다(이 저장소는 늘 안전한 쪽으로 기운다).
 */
export function windowSum(hours, from, to) {
  let sum = 0
  for (const [k, v] of Object.entries(hours || {})) {
    const at = Number(k)
    if (at >= hourKey(from) && at < to) sum += v || 0
  }
  return sum
}

/** 여러 세션의 시간 통을 하나로 — 창은 **계정 단위**로 물어야 한다 */
export function mergeHours(list) {
  const out = {}
  for (const hours of list) {
    for (const [k, v] of Object.entries(hours || {})) out[k] = (out[k] || 0) + (v || 0)
  }
  return out
}
