/**
 * sessions.mjs — 트랜스크립트를 **증분으로 읽어** 세션 목록과 사용량을 만든다.
 *
 * 🔴 왜 증분 스캔인가
 *   트랜스크립트는 크다 — 실측으로 한 파일이 21MB 였다. UI 가 몇 초마다 물어보는데
 *   매번 전체를 다시 파싱하면 디스크와 CPU 를 태운다. 파일별로 (크기·mtime·오프셋)을
 *   캐시해두고 **자란 부분만** 읽어 접는다. 파일이 줄었으면(정리·회전) 전체를 다시 읽는다.
 *
 * 줄 하나를 접는 규칙은 [session-fold.mjs](./session-fold.mjs) 에 있다(순수 함수).
 *   이 파일은 **어디까지 읽었나**만 관리한다 — 그 둘이 섞여 있으면 접기를 시험하려고
 *   파일과 캐시를 함께 흉내내야 한다.
 */
import { existsSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectsRoot, RS_HOME } from './config.mjs'
import { totalCost } from './pricing.mjs'
import { dayKey } from './stamp.mjs'
import { writeAtomic } from './io.mjs'
import { emptyTotals, foldLines, todayView, sumTokens } from './session-fold.mjs'

const cacheFile = join(RS_HOME, 'state', 'sessions-cache.json')

/**
 * 누적 구조의 판 번호. **구조를 바꿀 때마다 올린다.**
 *
 * 🔴 왜 필요한가 — 캐시에 든 누적은 다음 회차가 **그대로 이어서** 쓴다(자란 부분만 읽는다).
 *   그래서 새 칸을 더해도 옛 캐시에는 그 칸이 없고, 파일이 자라지 않는 세션은 그 칸이
 *   영원히 비어 있다. 오늘 몫을 넣을 때 실제로 그랬다 — 오늘 이미 일한 세션이 캐시를
 *   물려받아 "오늘 0" 으로 보였다. 판이 다르면 그 파일만 처음부터 다시 읽는다
 *   (전량 재스캔은 실측 186ms — 한 번 치를 값이다).
 */
/**
 * 6 — 기준선을 옛 사건에서도 배우려고 통 보관을 31일로 늘리고, 제한 기록을 **창 종류별**로
 *     남겼다(`quotaByType`). 5까지는 seven_day 사건이 five_hour 에 덮여 주간 %가 없었다.
 * 5 — 굴러가는 창(5시간·7일)을 재려고 **시간 통**(`hours`)을 넣었다(2026-09-29).
 *   옛 캐시에는 그 통이 없고, 파일이 자라지 않는 세션은 영원히 비어 있게 된다.
 *   (4 — 도구 결과를 `lastKind:'tool'` 로 갈랐다. 옛 캐시의 `lastKind` 는 못 믿는다.)
 */
const ACC_VERSION = 6

/* ── 파일 읽기 (증분) ────────────────────────────────────────── */

/** offset 바이트부터 끝까지 읽는다. 마지막 미완성 줄은 소비하지 않는다 */
function readPs(path, offset, size) {
  const len = size - offset
  if (len <= 0) return { text: '', nextOffset: offset }
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.allocUnsafe(len)
    readSync(fd, buf, 0, len, offset)
    const nl = buf.lastIndexOf(0x0a) // '\n'
    if (nl < 0) return { text: '', nextOffset: offset } // 완성된 줄이 아직 없다
    return { text: buf.subarray(0, nl + 1).toString('utf8'), nextOffset: offset + nl + 1 }
  } finally { closeSync(fd) }
}

function cacheRead() {
  if (!existsSync(cacheFile)) return {}
  try { return JSON.parse(readFileSync(cacheFile, 'utf8')) } catch { return {} }
}

/**
 * 전 세션을 훑는다. 캐시를 쓰고 갱신한다.
 * @param {object} opts.slugs 특정 슬러그만 (없으면 전체)
 * @returns {{sessions:Array, 할당량:object|null, 스캔:{파일:number, 새로읽음:number, ms:number}}}
 */
export function scanSessions({ slugs = null, useCache = true } = {}) {
  const startedText = Date.now()
  // 🔴 한 번만 읽는다. 세션마다 다시 읽으면 스캔이 자정을 걸치는 순간 세션끼리
  //   기준일이 갈라져 합계가 안 맞는다(오늘 합 ≠ 각 세션 오늘의 합).
  const todayKey = dayKey()
  const root = claudeProjectsRoot()
  const out = []
  const cacheBox = useCache ? cacheRead() : {}
  const newCache = {}
  let freshRead = 0, fileCount = 0

  if (!root || !existsSync(root)) {
    return { sessions: [], quota: null, scan: { files: 0, freshRead: 0, ms: 0 }, error: `~/.claude/projects 를 찾을 수 없다` }
  }

  for (const slug of readdirSync(root)) {
    if (slugs && !slugs.includes(slug)) continue
    const base = join(root, slug)
    let st
    try { st = statSync(base) } catch { continue }
    if (!st.isDirectory()) continue

    for (const f of readdirSync(base)) {
      if (!f.endsWith('.jsonl')) continue
      const path = join(base, f)
      const sessionId = f.replace(/\.jsonl$/, '')
      let fs_
      try { fs_ = statSync(path) } catch { continue }
      fileCount++

      // 판이 다른 누적은 없는 것으로 본다 — 빈 칸을 이어 쓰면 조용히 틀린 숫자가 남는다
      const c = cacheBox[path]?.v === ACC_VERSION ? cacheBox[path] : null
      let acc, offset

      if (c && c.size === fs_.size && c.mtimeMs === fs_.mtimeMs && c.acc) {
        acc = c.acc; offset = c.offset // 변한 게 없다 — 그대로 쓴다
      } else if (c && c.acc && fs_.size > c.size) {
        acc = c.acc; offset = c.offset // 자랐다 — 자란 부분만 읽는다
        const r = readPs(path, offset, fs_.size)
        foldLines(acc, r.text); offset = r.nextOffset; freshRead++
      } else {
        acc = emptyTotals(sessionId, slug); offset = 0 // 처음이거나 줄었다 — 전체를 읽는다
        const r = readPs(path, 0, fs_.size)
        foldLines(acc, r.text); offset = r.nextOffset; freshRead++
      }

      newCache[path] = { v: ACC_VERSION, size: fs_.size, mtimeMs: fs_.mtimeMs, offset, acc }

      const cost = totalCost(acc.byModel)
      // 오늘 몫은 **같은 단가 표**로 환산한다 — 두 곳에서 계산하면 합이 안 맞는다
      const today = todayView(acc, todayKey)
      const todayCost = totalCost(today.byModel)
      // 가장 많이 머문 곳 — "무엇을 하던 세션인가"를 가장 잘 말해준다
      const mainCwd = Object.entries(acc.cwdDist).sort((a, b) => b[1] - a[1])[0]?.[0] || null
      out.push({
        ...acc,
        mainCwd,
        cwdTop: Object.entries(acc.cwdDist).sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([p, n]) => ({ path: p, entries: n })),
        files: path,
        bytes: fs_.size,
        mtimeEpoch: fs_.mtimeMs,
        activeMin: +((Date.now() - fs_.mtimeMs) / 60000).toFixed(1),
        tokenSum: sumTokens(acc.byModel),
        // 아직 결과가 안 온 도구 — 비어 있지 않으면 지금 일하는 중이다(재개 판정이 본다)
        openTools: (acc.pendingTools || []).length,
        // 누가 다음 차례인가 — user 면 모델이 답을 빚지고 있다(일하는 중)
        lastKind: acc.lastKind || null,
        costUSD: cost.usd,
        costHasEstimate: cost.hasEstimate,
        /**
         * 오늘(로컬) 몫. 누적과 **나란히** 보여준다 — 누적만 보면 "지금 얼마나 쓰고
         * 있나"를 알 수 없고, 오늘만 보면 이 세션이 얼마짜리인지 알 수 없다.
         */
        todayKey: today.day,
        todayTokenSum: today.tokenSum,
        todayCostUSD: todayCost.usd,
        todayByModel: todayCost.byModel,
        todayUserMsgs: today.userMsgs,
        todayAssistantMsgs: today.assistantMsgs,
        todayToolCalls: today.toolCalls,
        todayToolResults: today.toolResults,
      })
    }
  }

  // 원자적으로 쓴다 — 찢어진 캐시는 다음 회차에 전량 재스캔을 부른다(실측: 186ms vs 3ms)
  try { writeAtomic(cacheFile, JSON.stringify(newCache)) } catch { /* 캐시 실패로 조회를 막지 않는다 */ }

  // 가장 최근 활동 순
  out.sort((a, b) => b.mtimeEpoch - a.mtimeEpoch)

  // 할당량은 전 세션 중 가장 최근 것이 현재 상태에 가장 가깝다
  let quota = null
  for (const s of out) {
    if (s.quota && (!quota || s.quota._at > quota._at)) quota = s.quota
  }

  return { sessions: out, quota, scan: { files: fileCount, freshRead, ms: Date.now() - startedText } }
}
