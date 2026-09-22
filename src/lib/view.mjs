/**
 * view.mjs — 집계한 값을 **사람이 읽을 형태로** 바꾼다. 여기에는 판정을 두지 않는다.
 *
 * 왜 나눴나
 *   status.mjs 가 410줄이 됐다(규칙은 400줄). 보기 좋게 바꾸는 일과 상태를 판정하는
 *   일은 이유가 다르고 같이 바뀌지 않는다 — 나누면 각각을 따로 시험할 수 있다.
 */
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { localStamp, minutesSince } from './stamp.mjs'
/* ── 로그 꼬리 읽기 ─────────────────────────────────────────── */

/**
 * 파일 끝에서 N줄. 🔴 전체를 읽지 않는다 — 로그는 계속 자라고 UI 는 자주 물어본다.
 * 마지막 64KB 만 읽어 그 안에서 줄을 센다.
 */
export function tail(path, n = 40, maxBytes = 65536) {
  if (!path || !existsSync(path)) return []
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    if (len <= 0) return []
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.allocUnsafe(len)
      readSync(fd, buf, 0, len, start)
      let text = buf.toString('utf8')
      // 앞이 잘렸으면 첫 줄은 깨졌을 수 있다 — 버린다
      if (start > 0) {
        const nl = text.indexOf('\n')
        if (nl >= 0) text = text.slice(nl + 1)
      }
      return text.split('\n').filter((l) => l !== '').slice(-n)
    } finally { closeSync(fd) }
  } catch { return [] }
}

/* ── 할당량 보기 ─────────────────────────────────────────────── */

/**
 * quotaLimits 를 사람이 읽을 형태로.
 *
 * 🔴 이 값은 **마지막으로 제한에 걸렸을 때 기록된 것**이다. 지금 상태가 아니다.
 *   resetsAt 이 과거면 이미 풀린 것이다 — 그걸 명시하지 않으면 "지금 막혀 있다"고 오해한다.
 */
export function quotaView(q) {
  if (!q) return { exists: false, desc: '기록 없음 — 이 PC 의 트랜스크립트에 제한 기록이 없다' }
  const resetMs = q.resetsAt ? q.resetsAt * 1000 : null
  const leftMin = resetMs ? Math.round((resetMs - Date.now()) / 60000) : null
  const passed = leftMin !== null && leftMin <= 0
  return {
    exists: true,
    status: q.status || null,
    kind: q.rateLimitType || null,
    recordedAt: q._at ? localStamp(new Date(q._at)) : null,
    recordedMinAgo: q._at ? Math.round(minutesSince(q._at)) : null,
    liftAt: resetMs ? localStamp(new Date(resetMs)) : null,
    liftInMin: leftMin,
    alreadyLifted: passed,
    inOverage: !!q.isUsingOverage,
    overageState: q.overageStatus || null,
    overageBlockedWhy: q.overageDisabledReason || null,
    canFallback: !!q.unifiedRateLimitFallbackAvailable,
    desc: passed
      ? `마지막 제한(${q.rateLimitType || '?'})은 이미 해제됐다 — ${resetMs ? localStamp(new Date(resetMs)) : '?'} 기준`
      : `제한 ${q.status || '?'} · ${q.rateLimitType || '?'} · ${leftMin}분 후 해제`,
  }
}

