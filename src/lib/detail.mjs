/**
 * detail.mjs — 한 세션이 "지금 무엇을 하고 있나"를 트랜스크립트 꼬리에서 읽는다.
 *
 * 왜 꼬리만 읽는가
 *   상세 화면은 실시간으로 갱신된다(몇 초마다). 트랜스크립트는 최대 21MB 였다(실측) —
 *   매번 전체를 파싱하면 화면 하나가 디스크를 태운다. 끝에서 정해진 바이트만 읽는다.
 *   앞이 잘려 첫 줄이 깨질 수 있으므로 그 줄은 버린다.
 *
 * 무엇을 뽑는가 — 사람이 "어디까지 갔나"를 판단하는 데 쓰는 것만
 *   사용자 요청 · 어시스턴트 답 요지 · 호출한 도구와 대상 · 턴별 토큰 · 마지막 미완결 도구
 */
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { claudeProjectsRoot } from './config.mjs'
import { localStamp } from './stamp.mjs'
import { normalizeModel } from './pricing.mjs'

/** 세션 id → 트랜스크립트 경로 */
export function findTranscript(sessionId) {
  const root = claudeProjectsRoot()
  if (!root || !existsSync(root)) return null
  for (const slug of readdirSync(root)) {
    const p = join(root, slug, `${sessionId}.jsonl`)
    if (existsSync(p)) return { path: p, slug }
  }
  return null
}

const shouldSkip = (line) =>
  line.includes('"type":"attachment"') ||
  line.includes('"type":"file-history-snapshot"') ||
  line.includes('"type":"file-history-delta"')

/** 도구 입력에서 사람이 알아볼 한 줄을 뽑는다 */
function toolDigest(name, input) {
  const i = input || {}
  const first = (...keys) => { for (const k of keys) if (i[k]) return String(i[k]) ; return null }
  const v =
    first('file_path', 'notebook_path', 'path') ||
    first('command') ||
    first('pattern') ||
    first('url') ||
    first('prompt', 'description') ||
    first('skill') ||
    null
  if (v) return v.length > 160 ? v.slice(0, 160) + '…' : v
  try {
    const s = JSON.stringify(i)
    return s.length > 160 ? s.slice(0, 160) + '…' : s
  } catch { return '' }
}

/** 어시스턴트 content 배열 → { 글, 사고있음, 도구[] } */
function assistantText(content) {
  let label = '', hasThinking = false
  const tools = []
  if (!Array.isArray(content)) return { label, hasThinking, tools }
  for (const b of content) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && b.text) label += (label ? '\n' : '') + b.text
    else if (b.type === 'thinking') hasThinking = true
    else if (b.type === 'tool_use') tools.push({ name: b.name, digest: toolDigest(b.name, b.input), id: b.id })
  }
  return { label, hasThinking, tools }
}

/** 사용자 content → 글 (도구 결과는 따로 표시한다) */
function userText(content) {
  if (typeof content === 'string') return { label: content, toolResult: [] }
  let label = ''
  const toolResult = []
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'text' && b.text) label += (label ? '\n' : '') + b.text
      else if (b.type === 'tool_result') {
        const c = b.content
        let digest = ''
        if (typeof c === 'string') digest = c
        else if (Array.isArray(c)) digest = c.map((x) => (x?.type === 'text' ? x.text : `[${x?.type}]`)).join('\n')
        toolResult.push({ id: b.tool_use_id, error: !!b.is_error, digest: String(digest).slice(0, 400) })
      }
    }
  }
  return { label, toolResult }
}

const cut = (s, n) => {
  const t = String(s || '').replace(/\r/g, '')
  return t.length > n ? t.slice(0, n) + '…' : t
}

/**
 * 세션 상세.
 * @param {string} sessionId
 * @param {object} opts.turns 최대 항목 수 (기본 40)
 * @param {object} opts.maxBytes 꼬리에서 읽을 바이트 (기본 512KB)
 */
export function sessionDetail(sessionId, { turns = 40, maxBytes = 512 * 1024, textLen = 1200 } = {}) {
  const found = findTranscript(sessionId)
  if (!found) return { ok: false, error: `트랜스크립트를 찾을 수 없다: ${sessionId}` }

  const { path, slug } = found
  const size = statSync(path).size
  const start = Math.max(0, size - maxBytes)
  const len = size - start

  let text = ''
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.allocUnsafe(len)
    readSync(fd, buf, 0, len, start)
    text = buf.toString('utf8')
  } finally { closeSync(fd) }

  // 앞이 잘렸으면 첫 줄은 깨졌다
  if (start > 0) {
    const nl = text.indexOf('\n')
    if (nl >= 0) text = text.slice(nl + 1)
  }

  const item = []
  const resultMap = new Map() // tool_use_id → 결과 (도구가 끝났는지 판정)

  for (const line of text.split('\n')) {
    if (!line || shouldSkip(line)) continue
    let j
    try { j = JSON.parse(line) } catch { continue }
    const at = j.timestamp ? localStamp(new Date(j.timestamp)) : null
    const atEpoch = j.timestamp ? Date.parse(j.timestamp) : null

    if (j.type === 'user') {
      const { label, toolResult } = userText(j.message?.content)
      for (const r of toolResult) resultMap.set(r.id, r)
      // 도구 결과만 있는 사용자 엔트리는 사람의 발화가 아니다 — 타임라인을 어지럽히지 않게 접는다
      if (label.trim()) {
        item.push({ kind: '사용자', at, atEpoch, label: cut(label, textLen), sidechain: !!j.isSidechain })
      } else if (toolResult.length) {
        item.push({
          kind: '도구결과', at, atEpoch, sidechain: !!j.isSidechain,
          result: toolResult.map((r) => ({ error: r.error, digest: cut(r.digest, 300) })),
        })
      }
    } else if (j.type === 'assistant') {
      const { label, hasThinking, tools } = assistantText(j.message?.content)
      const u = j.message?.usage || {}
      item.push({
        kind: '어시스턴트', at, atEpoch, sidechain: !!j.isSidechain,
        models: normalizeModel(j.message?.model),
        label: cut(label, textLen),
        hasThinking,
        tools,
        tokens: {
          input: u.input_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0,
          output: u.output_tokens || 0,
          thinking: u.output_tokens_details?.thinking_tokens || 0,
        },
        stop: j.message?.stop_reason || null,
      })
    } else if (j.type === 'ai-title' && j.aiTitle) {
      item.push({ kind: '제목', at, atEpoch, label: j.aiTitle })
    }
  }

  const latest = item.slice(-turns)

  /* 미완결 도구 = 호출됐는데 결과가 안 온 것. "지금 무엇을 하는 중"의 정답이다 */
  const unfinished = []
  for (const it of item) {
    if (it.kind !== '어시스턴트') continue
    for (const t of it.tools || []) if (!resultMap.has(t.id)) unfinished.push({ ...t, at: it.at })
  }

  const lastUser = [...item].reverse().find((i) => i.kind === '사용자') || null
  const lastAssistant = [...item].reverse().find((i) => i.kind === '어시스턴트' && i.label) || null
  const last = item.at(-1) || null

  return {
    ok: true,
    sessionId, slug, path,
    bytes: size,
    tailRead: len,
    fullRead: start === 0,
    mtimeEpoch: statSync(path).mtimeMs,
    activeMin: +((Date.now() - statSync(path).mtimeMs) / 60000).toFixed(1),
    item: latest,
    entryCount: item.length,
    // 🔴 이 세 값이 "처리 상황"이다 — 나머지는 근거다
    progress: {
      lastKind: last?.kind || null,
      lastTime: last?.at || null,
      openTools: unfinished.slice(-6),
      toolRunning: unfinished.length > 0,
    },
    lastUserReq: lastUser ? { at: lastUser.at, label: lastUser.label } : null,
    lastReply: lastAssistant ? { at: lastAssistant.at, label: lastAssistant.label, models: lastAssistant.models } : null,
  }
}
