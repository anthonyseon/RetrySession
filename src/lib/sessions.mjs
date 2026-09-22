/**
 * sessions.mjs — Claude Code 세션 목록과 사용량을 트랜스크립트에서 읽는다.
 *
 * 어디서 읽는가
 *   `~/.claude/projects/<slug>/<sessionId>.jsonl` — 세션 하나가 파일 하나다.
 *   필요한 것이 모두 여기 있다(실측 확인):
 *     assistant.message.usage  → 토큰 (입력·캐시쓰기·캐시읽기·출력·사고)
 *     assistant.message.model  → 모델 id
 *     ai-title.aiTitle         → 사람이 읽을 세션 제목
 *     cwd · gitBranch · version · timestamp
 *     quotaLimits              → 사용량 제한 상태·해제 시각
 *
 * 🔴 왜 증분 스캔인가
 *   트랜스크립트는 크다 — 실측으로 한 파일이 21MB 였다. UI 가 몇 초마다 물어보는데
 *   매번 전체를 다시 파싱하면 디스크와 CPU 를 태운다. 파일별로 (크기·mtime·오프셋)을
 *   캐시해두고 **자란 부분만** 읽어 접는다. 파일이 줄었으면(정리·회전) 전체를 다시 읽는다.
 */
import { readFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectsRoot, RS_HOME, pathKey } from './config.mjs'
import { emptyTokens, totalCost, normalizeModel } from './pricing.mjs'
import { writeAtomic } from './io.mjs'

const cacheFile = join(RS_HOME, 'state', 'sessions-cache.json')

/* ── 한 줄씩 접기 (순수) ─────────────────────────────────────── */

export const emptyTotals = (sessionId, slug) => ({
  sessionId, slug,
  // 🔴 cwd 는 세션 안에서 바뀐다 — 값 하나로 담으면 틀린다.
  //   실측: 세션 79e0e7e8 은 EasyAI.Platform(1443) · Description(4378) · Description/_plan/_resume(23)
  //   를 오갔다. 시작한 곳과 마지막으로 일한 곳이 다르고, 둘 다 쓸모가 다르다 —
  //   시작한 곳은 재시작을 띄울 자리이고, 마지막으로 일한 곳은 무엇을 하던 중이었나다.
  cwdStart: null, cwdLatest: null, cwdDist: {},
  gitBranch: null, version: null, title: null,
  firstAt: null, lastAt: null,
  userMsgs: 0, assistantMsgs: 0, toolCalls: 0,
  byModel: {},
  quota: null,
  /**
   * 🔴 이 세션이 **사용량 제한에 잘려서** 멈췄는가.
   *
   *   제한에 걸리면 트랜스크립트에 model `<synthetic>` 엔트리가 하나 들어간다.
   *   실측 표본: "You've hit your session limit · resets 1:30pm (Asia/Seoul)"
   *   토큰은 전부 0 이다 — 모델 호출이 아니라 로컬 알림이다(pricing.mjs 참조).
   *
   *   **마지막 엔트리가** 그것이면 "잘린 채 멈춰 있다"는 뜻이다. 그냥 놀고 있는
   *   세션과 구별해야 한다 — 제한이 풀렸다고 놀던 세션을 깨우면 아무도 시키지
   *   않은 일을 시작하는 것이다.
   *
   *   순차로 접으므로, 제한 알림을 만나면 켜고 다른 발화를 만나면 끈다.
   *   마지막 값이 곧 "마지막 엔트리가 제한 알림이었나"다.
   */
  stoppedByLimit: false,
  limitNoticeAt: null,
})

/**
 * `<synthetic>` 엔트리가 사용량 제한 알림인가. 순수 함수.
 *
 * 문구가 바뀔 수 있으므로 한 문장에 기대지 않고 몇 가지 신호를 함께 본다.
 * 🔴 모르면 false 다 — 제한이라고 잘못 보면 놀던 세션을 깨운다.
 */
export function isLimitNotice(message) {
  if (!message || normalizeModel(message.model) !== '<synthetic>') return false
  const c = message.content
  const label = typeof c === 'string' ? c
    : Array.isArray(c) ? c.map((b) => (b && b.type === 'text' ? b.text : '')).join(' ') : ''
  return /limit/i.test(label) && /(reset|usage|session|weekly)/i.test(label)
}

/** 분포 집계용 정규화 — config.mjs 의 공용 함수를 쓴다(제각기 정규화하면 키가 갈라진다) */
const cwdKey = pathKey

/** assistant.message.usage → 우리 토큰 형태 */
function extractTokens(u) {
  const cc = u.cache_creation || {}
  // cache_creation 세부가 없는 구버전은 전체를 5분 쓰기로 본다 — 싼 쪽으로 기울지 않게
  const hasDetailLine = typeof cc.ephemeral_1h_input_tokens === 'number' || typeof cc.ephemeral_5m_input_tokens === 'number'
  return {
    input: u.input_tokens || 0,
    cacheWrite1h: hasDetailLine ? (cc.ephemeral_1h_input_tokens || 0) : 0,
    cacheWrite5m: hasDetailLine ? (cc.ephemeral_5m_input_tokens || 0) : (u.cache_creation_input_tokens || 0),
    cacheRead: u.cache_read_input_tokens || 0,
    output: u.output_tokens || 0,
    thinking: u.output_tokens_details?.thinking_tokens || 0,
  }
}

/** quotaLimits 는 엔트리 안쪽에 묻혀 있다 — 찾아서 돌려준다 */
function findQuota(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return null
  if (o.quotaLimits && typeof o.quotaLimits === 'object') return o.quotaLimits
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') {
      const r = findQuota(v, depth + 1)
      if (r) return r
    }
  }
  return null
}

/**
 * 엔트리 하나를 누적에 접는다. 순수 함수 — 시험할 수 있다.
 * acc 를 제자리에서 고치고 돌려준다(큰 파일에서 객체를 새로 만들면 느리다).
 */
export function foldEntry(acc, j) {
  const ts = j.timestamp ? Date.parse(j.timestamp) : NaN
  if (Number.isFinite(ts)) {
    if (acc.firstAt === null || ts < acc.firstAt) acc.firstAt = ts
    if (acc.lastAt === null || ts > acc.lastAt) acc.lastAt = ts
  }
  if (j.cwd) {
    const k = cwdKey(j.cwd)
    if (!acc.cwdStart) acc.cwdStart = k
    acc.cwdLatest = k
    acc.cwdDist[k] = (acc.cwdDist[k] || 0) + 1
  }
  if (j.gitBranch) acc.gitBranch = j.gitBranch
  if (j.version) acc.version = j.version

  if (j.type === 'ai-title' && j.aiTitle) acc.title = j.aiTitle

  else if (j.type === 'user') { acc.userMsgs++; acc.stoppedByLimit = false }

  else if (j.type === 'assistant') {
    acc.assistantMsgs++
    const m = j.message || {}
    // 마지막 엔트리가 제한 알림이면 "잘린 채 멈춰 있다"는 뜻이다(빈껍데기 주석 참조)
    if (isLimitNotice(m)) {
      acc.stoppedByLimit = true
      if (Number.isFinite(ts)) acc.limitNoticeAt = ts
    } else {
      acc.stoppedByLimit = false
    }
    if (Array.isArray(m.content)) {
      for (const b of m.content) if (b && b.type === 'tool_use') acc.toolCalls++
    }
    if (m.usage) {
      const id = m.model || '(모델미상)'
      const cur = acc.byModel[id] || emptyTokens()
      const t = extractTokens(m.usage)
      for (const k of Object.keys(cur)) cur[k] += t[k] || 0
      acc.byModel[id] = cur
    }
  }

  // 할당량은 어느 엔트리에든 붙을 수 있다. 가장 최근 것만 남긴다.
  const q = findQuota(j)
  if (q && (acc.quota === null || (Number.isFinite(ts) && ts >= (acc.quota._at || 0)))) {
    acc.quota = { ...q, _at: Number.isFinite(ts) ? ts : Date.now() }
  }
  return acc
}

/**
 * 큰 엔트리는 건너뛴다 — attachment·file-history 는 수 MB 인데 필요한 것이 없다.
 * 🔴 건너뛰기 목록(skip-list)으로 판단한다. 포함 목록(include-list)으로 하면
 *   키 순서가 달라진 엔트리를 조용히 놓친다.
 */
const shouldSkip = (line) =>
  line.includes('"type":"attachment"') ||
  line.includes('"type":"file-history-snapshot"') ||
  line.includes('"type":"file-history-delta"')

export function foldLines(acc, text) {
  for (const line of text.split('\n')) {
    if (!line || shouldSkip(line)) continue
    try { foldEntry(acc, JSON.parse(line)) } catch { /* 쓰는 중인 마지막 줄은 깨질 수 있다 */ }
  }
  return acc
}

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

      const c = cacheBox[path]
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

      newCache[path] = { size: fs_.size, mtimeMs: fs_.mtimeMs, offset, acc }

      const cost = totalCost(acc.byModel)
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
        tokenSum: Object.values(acc.byModel).reduce((s, t) => s + t.input + t.cacheWrite1h + t.cacheWrite5m + t.cacheRead + t.output, 0),
        costUSD: cost.usd,
        costHasEstimate: cost.hasEstimate,
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
