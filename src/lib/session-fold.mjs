/**
 * session-fold.mjs — 트랜스크립트 **한 줄을 누적에 접는다.** 순수 함수만, IO 없음.
 *
 * 어디서 읽는가 (형식)
 *   ~/.claude/projects/<slug>/<sessionId>.jsonl — 세션 하나가 파일 하나다.
 *     assistant.message.usage  → 토큰 (입력·캐시쓰기·캐시읽기·출력·사고)
 *     assistant.message.model  → 모델 id
 *     ai-title.aiTitle         → 사람이 읽을 세션 제목
 *     cwd · gitBranch · version · timestamp
 *     quotaLimits              → 사용량 제한 상태·해제 시각
 *
 * 🔴 왜 파일 읽기와 갈랐나 — 400줄을 넘겼고, 자를 자리가 여기였다. 이쪽은 **줄 하나의
 *   뜻**을 정하고(그래서 시험이 쉽다), sessions.mjs 는 **어디까지 읽었나**를 관리한다.
 *   접기가 틀리면 숫자가 조용히 거짓이 되므로 시험이 닿는 자리에 두어야 한다.
 */
import { pathKey } from './config.mjs'
import { emptyTokens, normalizeModel } from './pricing.mjs'
import { dayKey } from './stamp.mjs'
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
  /** 도구 결과 엔트리 수 — `userMsgs` 와 갈라서 센다(도구 결과도 user 엔트리로 온다) */
  toolResults: 0,
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
  stoppedByInterrupt: false,
  interruptNoticeAt: null,

  /**
   * **오늘 몫** — 누적과 나란히 보여주기 위한 통 하나.
   *
   * 🔴 왜 날짜별 표가 아니라 통 하나인가
   *   이 누적은 `state/sessions-cache.json` 에 그대로 저장돼 다음 회차가 이어서 쓴다
   *   (트랜스크립트가 21MB 라 전량 재파싱을 못 한다). 날짜별로 모델 표를 쌓으면
   *   캐시가 세션이 살아 있는 날수만큼 커진다. 필요한 것은 "오늘"뿐이므로 통은 하나만
   *   두고, **날짜가 바뀌면 비운다.** 트랜스크립트는 시간순 append 라 그래도 맞는다.
   *
   * 🔴 `day` 는 **로컬** 날짜다(`stamp.dayKey`). `toISOString().slice(0,10)` 은 UTC 라서
   *   Asia/Seoul 에서는 하루 중 9시간 동안 어제 날짜를 준다 — 오늘 몫이 늘 0 으로 보인다.
   *   같은 함정을 재시작 예산에서 이미 밟았다(guard.recordRun).
   *
   * 🔴 시각이 없는 엔트리는 오늘로 세지 않는다. 모르는 것을 오늘로 몰면 오늘이 부풀고,
   *   부푼 숫자는 "오늘 얼마나 썼나"라는 질문에 거짓으로 답하는 것이다.
   */
  day: null,
  dayByModel: {},
  dayUserMsgs: 0, dayAssistantMsgs: 0, dayToolCalls: 0, dayToolResults: 0,

  /**
   * **아직 결과가 오지 않은 도구 호출 id.** 비어 있지 않으면 세션이 지금 일하는 중이다.
   *
   * 🔴 왜 필요한가 — "조용하다"를 마지막 기록 시각(파일 mtime)으로만 재면 **긴 도구 실행을
   *   유휴로 오판한다.** 10분 걸리는 빌드가 도는 동안 트랜스크립트에는 아무 줄도 늘지 않으므로
   *   "3분 넘게 조용하다"가 참이 된다. 그때 재개를 밀어넣으면 일하는 세션에 끼어드는 것이다.
   *   호출(tool_use)에 결과(tool_result)가 붙었는지로 보면 그 구멍이 막힌다.
   *
   * 🔴 끝이 있어야 한다 — 세션이 도구 도중에 죽으면 이 목록이 영원히 남는다. 그래서
   *   판정하는 쪽이 "조용한 시간이 아주 길면 낡은 것으로 본다"로 한계를 둔다(resume-gate).
   *   여기서는 관측만 하고, 길이만 막아 둔다(아래 CAP).
   */
  pendingTools: [],

  /**
   * 마지막으로 온 **말차례의 주인** — `'user'` 또는 `'assistant'`.
   *
   * 🔴 이것이 "누가 다음 차례인가"를 말한다. `'user'` 면 모델이 **답을 빚지고 있다**
   *   (사람이 방금 물었거나, 도구 결과가 막 돌아왔다) — 즉 세션이 일하는 중이다.
   *   `'assistant'` 면 모델이 답을 마치고 **사람을 기다리는** 상태다. 그때가 이어받을 자리다.
   *
   * 🔴 왜 도구 목록만으로는 부족한가 — 도구 없이 오래 생각하는 답(긴 사고)은 완성될 때까지
   *   트랜스크립트에 한 줄도 남지 않는다. 그 사이 미완결 도구는 0 이고 파일도 조용하다.
   *   마지막 차례가 사람이면 "아직 답이 안 나왔다"는 뜻이라 그 구멍을 메운다.
   */
  lastKind: null,
})

/**
 * 미완결 도구 목록의 상한. 넘으면 **오래된 쪽을 버린다.**
 * 이 배열은 캐시(JSON)에 그대로 저장되므로, 결과가 영원히 안 오는 호출이 쌓이면
 * 캐시가 커지고 판정도 흐려진다. 정상 세션은 동시에 몇 개를 넘지 않는다(실측 대부분 1~3).
 */
const PENDING_CAP = 40

/**
 * `<synthetic>` 엔트리가 사용량 제한 알림인가. 순수 함수.
 *
 * 문구가 바뀔 수 있으므로 한 문장에 기대지 않고 몇 가지 신호를 함께 본다.
 * 🔴 모르면 false 다 — 제한이라고 잘못 보면 놀던 세션을 깨운다.
 */
/**
 * 시스템이 끼워 넣은 알림의 글만 꺼낸다. `<synthetic>` 이 아니면 **아예 후보가 아니다.**
 *
 * 🔴 이 한 줄이 오탐을 통째로 막는다. 실측(2026-09-22, 800파일): `API Error:` 라는
 *   글자는 사람·어시스턴트가 **그 오류를 설명하는 산문**에도 나오고(`claude-opus-5`
 *   모델로 기록된다), 툴 출력에 인용되기도 한다. 화면을 긁는 도구들은 이걸 가르려고
 *   장식 걸러내기·툴출력 마스킹·산문 판별까지 만드는데, 우리는 모델 필드 하나로 끝난다.
 *   **이 관문을 지나서 판정하지 마라.**
 */
function noticeText(message) {
  if (!message || normalizeModel(message.model) !== '<synthetic>') return ''
  const c = message.content
  return typeof c === 'string' ? c
    : Array.isArray(c) ? c.map((b) => (b && b.type === 'text' ? b.text : '')).join(' ') : ''
}

export function isLimitNotice(message) {
  const label = noticeText(message)
  if (!label) return false
  return /limit/i.test(label) && /(reset|usage|session|weekly)/i.test(label)
}

/**
 * 응답이 **끝까지 오지 못하고 끊긴** 자리인가.
 *
 * 🔴 이 도구는 PC 절전을 **막는 데** 가장 공을 들였다(pc.mjs · 설정 모달 · powercfg
 *   백업까지). 그런데 막지 못해 실제로 잘린 세션은 재개 지점으로 쳐주지 않았다 —
 *   추적기도 재개지시도 없으면 "무엇을 이어서 할지 정해지지 않았다"로 영원히 거절했다.
 *   **막으려던 사고가 났을 때 정작 복구를 안 하는 셈이다.**
 *
 * 🔴 문구는 지어내지 않고 실측했다 (트랜스크립트 800파일·106,329줄, 2026-09-22):
 *     `API Error: The response stopped arriving. The response above may be incomplete.`
 *   절전만이 아니라 네트워크가 멎어도 같은 글이 남는다. 그래서 이름을 '절전'이 아니라
 *   '끊김'으로 둔다 — 원인이 아니라 **상태**를 말해야 판정이 흔들리지 않는다.
 */
export function isInterruptedNotice(message) {
  const label = noticeText(message)
  if (!label) return false
  return /response stopped arriving|went to sleep mid-response|response above may be incomplete/i.test(label)
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

  /**
   * 이 엔트리가 **지금 담고 있는 날**의 것인가 (오늘 몫 계산).
   *
   * 날짜가 넘어가면 통을 비우고 새 날로 바꾼다. 거꾸로 온 엔트리(더 이른 날짜)는
   * 통을 건드리지 않는다 — 시간순이 아닌 줄 하나가 오늘 몫을 지워 버리면 안 된다.
   * `YYYY-MM-DD` 는 문자열 비교로도 날짜 순서가 맞는다.
   */
  const entryDay = Number.isFinite(ts) ? dayKey(new Date(ts)) : null
  const inDay = entryDay !== null && (acc.day === null || entryDay >= acc.day)
  if (inDay && entryDay !== acc.day) {
    acc.day = entryDay
    acc.dayByModel = {}
    acc.dayUserMsgs = 0; acc.dayAssistantMsgs = 0; acc.dayToolCalls = 0; acc.dayToolResults = 0
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

  // 사람이 다시 입력했으면 잘린 자리가 아니다 — 이어서 쓰고 있다는 뜻이다
  else if (j.type === 'user') {
    /**
     * 🔴 **도구 결과도 `user` 엔트리로 온다** — 그래서 둘을 갈라야 한다 (실측 2026-09-28).
     *
     *   예전에는 둘을 같이 세어 두 가지가 동시에 틀렸다:
     *     ① `lastKind` 가 `'user'` 가 되어, 우리가 타임아웃으로 죽인 회차의 마지막
     *        도구 결과를 **「마지막 차례가 사람이다」** 로 읽었다. 사람은 아무 말도 하지
     *        않았는데 그 세션은 다음 30분(타임아웃분) 동안 «일하는 중» 으로 막혔다 —
     *        실측으로 19:03 kill 뒤 다음 회차가 정확히 30.1분 뒤에야 돌았다.
     *     ② `userMsgs` 가 부풀었다. 「사람 메시지 2031 · 도구 1919」 처럼 보였는데
     *        사람이 2031번 입력한 것이 아니다 — 화면이 그 숫자를 그대로 보여주면 거짓이다.
     *
     *   판정 쪽에서 셋을 구별할 수 있어야 한다: 사람이 물었다(`user`) · 도구 결과가
     *   돌아왔다(`tool`) · 모델이 답했다(`assistant`). resume-gate 가 이것을 쓴다.
     */
    const c = j.message?.content
    const blocks = Array.isArray(c) ? c.filter(Boolean) : []
    const isToolResult = blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')

    if (isToolResult) {
      acc.toolResults++
      acc.lastKind = 'tool'
      if (inDay) acc.dayToolResults++
    } else {
      acc.userMsgs++
      acc.lastKind = 'user'
      if (inDay) acc.dayUserMsgs++
    }
    acc.stoppedByLimit = false; acc.stoppedByInterrupt = false

    // 결과가 왔으면 그 호출은 끝난 것이다 — 미완결 목록에서 뺀다
    if (blocks.length && acc.pendingTools?.length) {
      for (const b of blocks) {
        if (b.type !== 'tool_result' || !b.tool_use_id) continue
        const i = acc.pendingTools.indexOf(b.tool_use_id)
        if (i >= 0) acc.pendingTools.splice(i, 1)
      }
    }
  }

  else if (j.type === 'assistant') {
    acc.assistantMsgs++
    acc.lastKind = 'assistant'
    if (inDay) acc.dayAssistantMsgs++
    const m = j.message || {}
    // 마지막 엔트리가 제한 알림이면 "잘린 채 멈춰 있다"는 뜻이다(빈껍데기 주석 참조)
    if (isLimitNotice(m)) {
      acc.stoppedByLimit = true
      if (Number.isFinite(ts)) acc.limitNoticeAt = ts
    } else {
      acc.stoppedByLimit = false
    }
    // 끊김도 같은 자리에서 본다 — **마지막** 엔트리여야 "지금 잘려 있다"는 뜻이다
    if (isInterruptedNotice(m)) {
      acc.stoppedByInterrupt = true
      if (Number.isFinite(ts)) acc.interruptNoticeAt = ts
    } else {
      acc.stoppedByInterrupt = false
    }
    if (Array.isArray(m.content)) {
      for (const b of m.content) {
        if (!b || b.type !== 'tool_use') continue
        acc.toolCalls++
        if (inDay) acc.dayToolCalls++
        // 결과가 오면 지운다(user 분기). 남아 있으면 "지금 그 도구가 돌고 있다"는 뜻이다.
        if (b.id) {
          if (!acc.pendingTools) acc.pendingTools = []
          acc.pendingTools.push(b.id)
          if (acc.pendingTools.length > PENDING_CAP) acc.pendingTools.splice(0, acc.pendingTools.length - PENDING_CAP)
        }
      }
    }
    if (m.usage) {
      const id = m.model || '(모델미상)'
      const t = extractTokens(m.usage)
      // 누적과 오늘 몫에 **같은 값**을 접는다. 한 곳만 고치면 둘이 어긋난다.
      for (const bin of inDay ? [acc.byModel, acc.dayByModel] : [acc.byModel]) {
        const cur = bin[id] || emptyTokens()
        for (const k of Object.keys(cur)) cur[k] += t[k] || 0
        bin[id] = cur
      }
    }
  }

  // 할당량은 어느 엔트리에든 붙을 수 있다. 가장 최근 것만 남긴다.
  const q = findQuota(j)
  if (q && (acc.quota === null || (Number.isFinite(ts) && ts >= (acc.quota._at || 0)))) {
    acc.quota = { ...q, _at: Number.isFinite(ts) ? ts : Date.now() }
  }
  return acc
}

/** 토큰 다섯 칸의 합 — 사고 토큰은 출력에 포함되므로 따로 더하지 않는다 */
export const sumTokens = (byModel) =>
  Object.values(byModel || {}).reduce(
    (s, t) => s + t.input + t.cacheWrite1h + t.cacheWrite5m + t.cacheRead + t.output, 0)

/**
 * 누적에서 **오늘 몫만** 꺼낸다. 순수 함수.
 *
 * 🔴 담아 둔 날짜가 오늘이 아니면 **0 으로 답한다.** 어제 쓴 것을 오늘 것이라 말하면
 *   "오늘 얼마나 썼나"가 거짓이 된다. 자정을 넘기면 파일이 자라지 않아도 0 이 되어야
 *   하므로, 비우는 일을 **읽는 쪽에서** 한 번 더 한다(캐시는 그대로 남아 있다).
 *
 * @param acc   emptyTotals 로 접은 누적
 * @param today 오늘의 로컬 날짜 키 (시험에서 자정을 넘겨 보기 위해 받는다)
 */
export function todayView(acc, today = dayKey()) {
  const mine = acc && acc.day === today
  const byModel = mine ? (acc.dayByModel || {}) : {}
  return {
    day: today,
    byModel,
    tokenSum: sumTokens(byModel),
    userMsgs: mine ? (acc.dayUserMsgs || 0) : 0,
    assistantMsgs: mine ? (acc.dayAssistantMsgs || 0) : 0,
    toolCalls: mine ? (acc.dayToolCalls || 0) : 0,
    toolResults: mine ? (acc.dayToolResults || 0) : 0,
  }
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
