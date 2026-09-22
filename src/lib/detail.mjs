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
    if (existsSync(p)) return { 경로: p, slug }
  }
  return null
}

const 건너뛸까 = (line) =>
  line.includes('"type":"attachment"') ||
  line.includes('"type":"file-history-snapshot"') ||
  line.includes('"type":"file-history-delta"')

/** 도구 입력에서 사람이 알아볼 한 줄을 뽑는다 */
function toolDigest(name, input) {
  const i = input || {}
  const 첫 = (...keys) => { for (const k of keys) if (i[k]) return String(i[k]) ; return null }
  const v =
    첫('file_path', 'notebook_path', 'path') ||
    첫('command') ||
    첫('pattern') ||
    첫('url') ||
    첫('prompt', 'description') ||
    첫('skill') ||
    null
  if (v) return v.length > 160 ? v.slice(0, 160) + '…' : v
  try {
    const s = JSON.stringify(i)
    return s.length > 160 ? s.slice(0, 160) + '…' : s
  } catch { return '' }
}

/** 어시스턴트 content 배열 → { 글, 사고있음, 도구[] } */
function assistantText(content) {
  let 글 = '', 사고있음 = false
  const 도구 = []
  if (!Array.isArray(content)) return { 글, 사고있음, 도구 }
  for (const b of content) {
    if (!b || typeof b !== 'object') continue
    if (b.type === 'text' && b.text) 글 += (글 ? '\n' : '') + b.text
    else if (b.type === 'thinking') 사고있음 = true
    else if (b.type === 'tool_use') 도구.push({ 이름: b.name, 요지: toolDigest(b.name, b.input), id: b.id })
  }
  return { 글, 사고있음, 도구 }
}

/** 사용자 content → 글 (도구 결과는 따로 표시한다) */
function userText(content) {
  if (typeof content === 'string') return { 글: content, 도구결과: [] }
  let 글 = ''
  const 도구결과 = []
  if (Array.isArray(content)) {
    for (const b of content) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'text' && b.text) 글 += (글 ? '\n' : '') + b.text
      else if (b.type === 'tool_result') {
        const c = b.content
        let 요지 = ''
        if (typeof c === 'string') 요지 = c
        else if (Array.isArray(c)) 요지 = c.map((x) => (x?.type === 'text' ? x.text : `[${x?.type}]`)).join('\n')
        도구결과.push({ id: b.tool_use_id, 오류: !!b.is_error, 요지: String(요지).slice(0, 400) })
      }
    }
  }
  return { 글, 도구결과 }
}

const 자르기 = (s, n) => {
  const t = String(s || '').replace(/\r/g, '')
  return t.length > n ? t.slice(0, n) + '…' : t
}

/**
 * 세션 상세.
 * @param {string} sessionId
 * @param {object} opts.turns 최대 항목 수 (기본 40)
 * @param {object} opts.maxBytes 꼬리에서 읽을 바이트 (기본 512KB)
 */
export function sessionDetail(sessionId, { turns = 40, maxBytes = 512 * 1024, 글길이 = 1200 } = {}) {
  const 찾음 = findTranscript(sessionId)
  if (!찾음) return { ok: false, 오류: `트랜스크립트를 찾을 수 없다: ${sessionId}` }

  const { 경로, slug } = 찾음
  const size = statSync(경로).size
  const start = Math.max(0, size - maxBytes)
  const len = size - start

  let text = ''
  const fd = openSync(경로, 'r')
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

  const 항목 = []
  const 결과맵 = new Map() // tool_use_id → 결과 (도구가 끝났는지 판정)

  for (const line of text.split('\n')) {
    if (!line || 건너뛸까(line)) continue
    let j
    try { j = JSON.parse(line) } catch { continue }
    const at = j.timestamp ? localStamp(new Date(j.timestamp)) : null
    const atEpoch = j.timestamp ? Date.parse(j.timestamp) : null

    if (j.type === 'user') {
      const { 글, 도구결과 } = userText(j.message?.content)
      for (const r of 도구결과) 결과맵.set(r.id, r)
      // 도구 결과만 있는 사용자 엔트리는 사람의 발화가 아니다 — 타임라인을 어지럽히지 않게 접는다
      if (글.trim()) {
        항목.push({ 종류: '사용자', at, atEpoch, 글: 자르기(글, 글길이), 사이드체인: !!j.isSidechain })
      } else if (도구결과.length) {
        항목.push({
          종류: '도구결과', at, atEpoch, 사이드체인: !!j.isSidechain,
          결과: 도구결과.map((r) => ({ 오류: r.오류, 요지: 자르기(r.요지, 300) })),
        })
      }
    } else if (j.type === 'assistant') {
      const { 글, 사고있음, 도구 } = assistantText(j.message?.content)
      const u = j.message?.usage || {}
      항목.push({
        종류: '어시스턴트', at, atEpoch, 사이드체인: !!j.isSidechain,
        모델: normalizeModel(j.message?.model),
        글: 자르기(글, 글길이),
        사고있음,
        도구,
        토큰: {
          입력: u.input_tokens || 0,
          캐시읽기: u.cache_read_input_tokens || 0,
          출력: u.output_tokens || 0,
          사고: u.output_tokens_details?.thinking_tokens || 0,
        },
        stop: j.message?.stop_reason || null,
      })
    } else if (j.type === 'ai-title' && j.aiTitle) {
      항목.push({ 종류: '제목', at, atEpoch, 글: j.aiTitle })
    }
  }

  const 최근 = 항목.slice(-turns)

  /* 미완결 도구 = 호출됐는데 결과가 안 온 것. "지금 무엇을 하는 중"의 정답이다 */
  const 미완결 = []
  for (const it of 항목) {
    if (it.종류 !== '어시스턴트') continue
    for (const t of it.도구 || []) if (!결과맵.has(t.id)) 미완결.push({ ...t, at: it.at })
  }

  const 마지막사용자 = [...항목].reverse().find((i) => i.종류 === '사용자') || null
  const 마지막어시스턴트 = [...항목].reverse().find((i) => i.종류 === '어시스턴트' && i.글) || null
  const 마지막 = 항목.at(-1) || null

  return {
    ok: true,
    sessionId, slug, 경로,
    바이트: size,
    꼬리읽음: len,
    전체읽음: start === 0,
    수정epoch: statSync(경로).mtimeMs,
    활성분: +((Date.now() - statSync(경로).mtimeMs) / 60000).toFixed(1),
    항목: 최근,
    항목수: 항목.length,
    // 🔴 이 세 값이 "처리 상황"이다 — 나머지는 근거다
    진행: {
      마지막종류: 마지막?.종류 || null,
      마지막시각: 마지막?.at || null,
      미완결도구: 미완결.slice(-6),
      도구실행중: 미완결.length > 0,
    },
    마지막사용자요청: 마지막사용자 ? { at: 마지막사용자.at, 글: 마지막사용자.글 } : null,
    마지막답: 마지막어시스턴트 ? { at: 마지막어시스턴트.at, 글: 마지막어시스턴트.글, 모델: 마지막어시스턴트.모델 } : null,
  }
}
