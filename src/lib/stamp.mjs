/**
 * stamp.mjs — 시각 표기를 한 곳에 모은다.
 *
 * 🔴 왜 로컬 시간인가 (실측 사고)
 *   2026-09-17: 기록을 toISOString() 으로 남겼더니 로컬 16:16 인데 파일에는 07:16 으로
 *   적혔다(UTC). 재개할 때 "하트비트가 9시간 낡았다"고 오판하게 된다.
 *   사람이 읽는 표기는 로컬 시간으로 적는다.
 *
 * 🔴 낡음 판정은 문자열이 아니라 epoch 정수로 한다.
 *   표기·시간대·서머타임에 흔들리지 않는 유일한 값이다.
 */

const p = (n) => String(n).padStart(2, '0')

/** 사람이 읽는 표기 — `YYYY-MM-DD HH:MM:SS` (로컬) */
export function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    ` ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 하루 예산 집계 키 — `YYYY-MM-DD` (로컬 기준. 자정에 바뀐다) */
export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 조용한 시간 판정용 — 자정부터의 분 */
export function minuteOfDay(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * epoch 로부터 몇 분 지났나. 소수 1자리.
 * 미래 값이면 음수를 그대로 돌려준다 — 시계 어긋남을 감추지 않는다.
 */
export function minutesSince(epochMs, now = Date.now()) {
  return +((now - epochMs) / 60000).toFixed(1)
}

/** `HH:MM` → 자정부터의 분. 형식이 틀리면 null (호출부가 fail-closed 로 처리한다) */
export function parseHhmm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const h = +m[1], mi = +m[2]
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}
