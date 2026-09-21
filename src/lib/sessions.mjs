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
import { claudeProjectsRoot, RS_HOME, 경로키 } from './config.mjs'
import { 빈토큰, 총비용 } from './pricing.mjs'
import { 원자쓰기 } from './io.mjs'

const 캐시파일 = join(RS_HOME, 'state', 'sessions-cache.json')

/* ── 한 줄씩 접기 (순수) ─────────────────────────────────────── */

export const 빈누적 = (sessionId, slug) => ({
  sessionId, slug,
  // 🔴 cwd 는 세션 안에서 바뀐다 — 값 하나로 담으면 틀린다.
  //   실측: 세션 79e0e7e8 은 EasyAI.Platform(1443) · Description(4378) · Description/_plan/_resume(23)
  //   를 오갔다. 시작한 곳과 마지막으로 일한 곳이 다르고, 둘 다 쓸모가 다르다 —
  //   시작한 곳은 재시작을 띄울 자리이고, 마지막으로 일한 곳은 무엇을 하던 중이었나다.
  cwd시작: null, cwd최근: null, cwd분포: {},
  gitBranch: null, version: null, title: null,
  첫활동: null, 마지막활동: null,
  사용자메시지: 0, 어시스턴트메시지: 0, 도구호출: 0,
  모델별: {},
  할당량: null,
})

/** 분포 집계용 정규화 — config.mjs 의 공용 함수를 쓴다(제각기 정규화하면 키가 갈라진다) */
const cwd키 = 경로키

/** assistant.message.usage → 우리 토큰 형태 */
function 토큰추출(u) {
  const cc = u.cache_creation || {}
  // cache_creation 세부가 없는 구버전은 전체를 5분 쓰기로 본다 — 싼 쪽으로 기울지 않게
  const has세부 = typeof cc.ephemeral_1h_input_tokens === 'number' || typeof cc.ephemeral_5m_input_tokens === 'number'
  return {
    입력: u.input_tokens || 0,
    캐시쓰기1h: has세부 ? (cc.ephemeral_1h_input_tokens || 0) : 0,
    캐시쓰기5m: has세부 ? (cc.ephemeral_5m_input_tokens || 0) : (u.cache_creation_input_tokens || 0),
    캐시읽기: u.cache_read_input_tokens || 0,
    출력: u.output_tokens || 0,
    사고: u.output_tokens_details?.thinking_tokens || 0,
  }
}

/** quotaLimits 는 엔트리 안쪽에 묻혀 있다 — 찾아서 돌려준다 */
function 할당량찾기(o, 깊이 = 0) {
  if (!o || typeof o !== 'object' || 깊이 > 6) return null
  if (o.quotaLimits && typeof o.quotaLimits === 'object') return o.quotaLimits
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') {
      const r = 할당량찾기(v, 깊이 + 1)
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
    if (acc.첫활동 === null || ts < acc.첫활동) acc.첫활동 = ts
    if (acc.마지막활동 === null || ts > acc.마지막활동) acc.마지막활동 = ts
  }
  if (j.cwd) {
    const k = cwd키(j.cwd)
    if (!acc.cwd시작) acc.cwd시작 = k
    acc.cwd최근 = k
    acc.cwd분포[k] = (acc.cwd분포[k] || 0) + 1
  }
  if (j.gitBranch) acc.gitBranch = j.gitBranch
  if (j.version) acc.version = j.version

  if (j.type === 'ai-title' && j.aiTitle) acc.title = j.aiTitle

  else if (j.type === 'user') acc.사용자메시지++

  else if (j.type === 'assistant') {
    acc.어시스턴트메시지++
    const m = j.message || {}
    if (Array.isArray(m.content)) {
      for (const b of m.content) if (b && b.type === 'tool_use') acc.도구호출++
    }
    if (m.usage) {
      const id = m.model || '(모델미상)'
      const cur = acc.모델별[id] || 빈토큰()
      const t = 토큰추출(m.usage)
      for (const k of Object.keys(cur)) cur[k] += t[k] || 0
      acc.모델별[id] = cur
    }
  }

  // 할당량은 어느 엔트리에든 붙을 수 있다. 가장 최근 것만 남긴다.
  const q = 할당량찾기(j)
  if (q && (acc.할당량 === null || (Number.isFinite(ts) && ts >= (acc.할당량._at || 0)))) {
    acc.할당량 = { ...q, _at: Number.isFinite(ts) ? ts : Date.now() }
  }
  return acc
}

/**
 * 큰 엔트리는 건너뛴다 — attachment·file-history 는 수 MB 인데 필요한 것이 없다.
 * 🔴 건너뛰기 목록(skip-list)으로 판단한다. 포함 목록(include-list)으로 하면
 *   키 순서가 달라진 엔트리를 조용히 놓친다.
 */
const 건너뛸까 = (line) =>
  line.includes('"type":"attachment"') ||
  line.includes('"type":"file-history-snapshot"') ||
  line.includes('"type":"file-history-delta"')

export function foldLines(acc, text) {
  for (const line of text.split('\n')) {
    if (!line || 건너뛸까(line)) continue
    try { foldEntry(acc, JSON.parse(line)) } catch { /* 쓰는 중인 마지막 줄은 깨질 수 있다 */ }
  }
  return acc
}

/* ── 파일 읽기 (증분) ────────────────────────────────────────── */

/** offset 바이트부터 끝까지 읽는다. 마지막 미완성 줄은 소비하지 않는다 */
function 읽기(path, offset, size) {
  const len = size - offset
  if (len <= 0) return { text: '', 다음offset: offset }
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.allocUnsafe(len)
    readSync(fd, buf, 0, len, offset)
    const nl = buf.lastIndexOf(0x0a) // '\n'
    if (nl < 0) return { text: '', 다음offset: offset } // 완성된 줄이 아직 없다
    return { text: buf.subarray(0, nl + 1).toString('utf8'), 다음offset: offset + nl + 1 }
  } finally { closeSync(fd) }
}

function 캐시읽기() {
  if (!existsSync(캐시파일)) return {}
  try { return JSON.parse(readFileSync(캐시파일, 'utf8')) } catch { return {} }
}

/**
 * 전 세션을 훑는다. 캐시를 쓰고 갱신한다.
 * @param {object} opts.slugs 특정 슬러그만 (없으면 전체)
 * @returns {{sessions:Array, 할당량:object|null, 스캔:{파일:number, 새로읽음:number, ms:number}}}
 */
export function scanSessions({ slugs = null, useCache = true } = {}) {
  const 시작 = Date.now()
  const root = claudeProjectsRoot()
  const out = []
  const 캐시 = useCache ? 캐시읽기() : {}
  const 새캐시 = {}
  let 새로읽음 = 0, 파일수 = 0

  if (!root || !existsSync(root)) {
    return { sessions: [], 할당량: null, 스캔: { 파일: 0, 새로읽음: 0, ms: 0 }, 오류: `~/.claude/projects 를 찾을 수 없다` }
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
      파일수++

      const c = 캐시[path]
      let acc, offset

      if (c && c.size === fs_.size && c.mtimeMs === fs_.mtimeMs && c.acc) {
        acc = c.acc; offset = c.offset // 변한 게 없다 — 그대로 쓴다
      } else if (c && c.acc && fs_.size > c.size) {
        acc = c.acc; offset = c.offset // 자랐다 — 자란 부분만 읽는다
        const r = 읽기(path, offset, fs_.size)
        foldLines(acc, r.text); offset = r.다음offset; 새로읽음++
      } else {
        acc = 빈누적(sessionId, slug); offset = 0 // 처음이거나 줄었다 — 전체를 읽는다
        const r = 읽기(path, 0, fs_.size)
        foldLines(acc, r.text); offset = r.다음offset; 새로읽음++
      }

      새캐시[path] = { size: fs_.size, mtimeMs: fs_.mtimeMs, offset, acc }

      const 비용 = 총비용(acc.모델별)
      // 가장 많이 머문 곳 — "무엇을 하던 세션인가"를 가장 잘 말해준다
      const 주작업cwd = Object.entries(acc.cwd분포).sort((a, b) => b[1] - a[1])[0]?.[0] || null
      out.push({
        ...acc,
        주작업cwd,
        cwd상위: Object.entries(acc.cwd분포).sort((a, b) => b[1] - a[1]).slice(0, 4)
          .map(([p, n]) => ({ 경로: p, 엔트리: n })),
        파일: path,
        바이트: fs_.size,
        수정epoch: fs_.mtimeMs,
        활성분: +((Date.now() - fs_.mtimeMs) / 60000).toFixed(1),
        토큰합: Object.values(acc.모델별).reduce((s, t) => s + t.입력 + t.캐시쓰기1h + t.캐시쓰기5m + t.캐시읽기 + t.출력, 0),
        비용USD: 비용.usd,
        비용추정포함: 비용.추정포함,
      })
    }
  }

  // 원자적으로 쓴다 — 찢어진 캐시는 다음 회차에 전량 재스캔을 부른다(실측: 186ms vs 3ms)
  try { 원자쓰기(캐시파일, JSON.stringify(새캐시)) } catch { /* 캐시 실패로 조회를 막지 않는다 */ }

  // 가장 최근 활동 순
  out.sort((a, b) => b.수정epoch - a.수정epoch)

  // 할당량은 전 세션 중 가장 최근 것이 현재 상태에 가장 가깝다
  let 할당량 = null
  for (const s of out) {
    if (s.할당량 && (!할당량 || s.할당량._at > 할당량._at)) 할당량 = s.할당량
  }

  return { sessions: out, 할당량, 스캔: { 파일: 파일수, 새로읽음, ms: Date.now() - 시작 } }
}
