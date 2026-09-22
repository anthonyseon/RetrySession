/**
 * sessions.test.mjs — 트랜스크립트 접기와 할당량 해석을 고정한다.
 *
 * 엔트리 모양은 실측에서 가져왔다(~/.claude/projects/<slug>/<sessionId>.jsonl).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyTotals, foldEntry, foldLines, isLimitNotice, isInterruptedNotice } from '../src/lib/sessions.mjs'
import { quotaView } from '../src/lib/status.mjs'

const A = (o) => ({ type: 'assistant', timestamp: '2026-09-18T01:00:00.000Z', ...o })

test('assistant.usage 의 토큰을 모델별로 모은다', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, A({
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 2, cache_read_input_tokens: 100, output_tokens: 50,
        cache_creation_input_tokens: 30,
        cache_creation: { ephemeral_1h_input_tokens: 30, ephemeral_5m_input_tokens: 0 },
        output_tokens_details: { thinking_tokens: 12 },
      },
    },
  }))
  const t = acc.byModel['claude-opus-5']
  assert.equal(t.input, 2)
  assert.equal(t.cacheRead, 100)
  assert.equal(t.output, 50)
  assert.equal(t.cacheWrite1h, 30)
  assert.equal(t.cacheWrite5m, 0)
  assert.equal(t.thinking, 12)
  assert.equal(acc.assistantMsgs, 1)
})

test('🔴 cache_creation 세부가 없으면 전체를 5분 쓰기로 본다 — 싼 쪽으로 기울지 않게', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, A({ message: { model: 'm', usage: { cache_creation_input_tokens: 1000 } } }))
  const t = acc.byModel.m
  assert.equal(t.cacheWrite5m, 1000)
  assert.equal(t.cacheWrite1h, 0)
})

test('tool_use 블록을 센다', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, A({
    message: {
      model: 'm', usage: {},
      content: [
        { type: 'text', text: '합니다' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
        { type: 'tool_use', name: 'Read', input: { file_path: 'a.txt' } },
      ],
    },
  }))
  assert.equal(acc.toolCalls, 2)
})

test('ai-title 이 제목이 된다 (마지막 것이 이긴다)', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, { type: 'ai-title', aiTitle: '첫 제목' })
  foldEntry(acc, { type: 'ai-title', aiTitle: '나중 제목' })
  assert.equal(acc.title, '나중 제목')
})

test('🔴 cwd 는 시작·최근·분포로 나눠 담는다 (실측: 한 세션이 여러 곳을 오갔다)', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, { type: 'user', cwd: 'C:\\a\\Platform', timestamp: '2026-09-18T01:00:00Z', message: { content: 'x' } })
  foldEntry(acc, { type: 'user', cwd: 'C:\\a\\Description', timestamp: '2026-09-18T01:01:00Z', message: { content: 'x' } })
  foldEntry(acc, { type: 'user', cwd: 'C:\\a\\Description', timestamp: '2026-09-18T01:02:00Z', message: { content: 'x' } })
  assert.equal(acc.cwdStart, 'C:/a/Platform', '시작한 곳은 바뀌지 않는다')
  assert.equal(acc.cwdLatest, 'C:/a/Description')
  assert.equal(acc.cwdDist['C:/a/Description'], 2)
})

test('cwd 드라이브 문자 대소문자를 합친다 (실측: c:\\ 와 C:\\ 가 섞여 들어온다)', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, { type: 'user', cwd: 'c:\\a\\b', message: { content: 'x' } })
  foldEntry(acc, { type: 'user', cwd: 'C:\\a\\b', message: { content: 'x' } })
  assert.deepEqual(Object.keys(acc.cwdDist), ['C:/a/b'], '같은 경로가 둘로 갈라지면 분포가 거짓이 된다')
  assert.equal(acc.cwdDist['C:/a/b'], 2)
})

test('첫·마지막 활동 시각을 잡는다 (순서가 뒤섞여 들어와도)', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, A({ timestamp: '2026-09-18T05:00:00.000Z', message: { model: 'm', usage: {} } }))
  foldEntry(acc, A({ timestamp: '2026-09-18T01:00:00.000Z', message: { model: 'm', usage: {} } }))
  assert.equal(acc.firstAt, Date.parse('2026-09-18T01:00:00.000Z'))
  assert.equal(acc.lastAt, Date.parse('2026-09-18T05:00:00.000Z'))
})

test('quotaLimits 를 안쪽에서 찾아 가장 최근 것만 남긴다', () => {
  const acc = emptyTotals('s1', 'slug')
  foldEntry(acc, { type: 'user', timestamp: '2026-09-17T00:00:00Z', message: { content: 'x' }, deep: { quotaLimits: { status: 'old' } } })
  foldEntry(acc, { type: 'user', timestamp: '2026-09-18T00:00:00Z', message: { content: 'x' }, a: { b: { quotaLimits: { status: 'new' } } } })
  assert.equal(acc.quota.status, 'new')
})

test('🔴 attachment·file-history 줄은 건너뛴다 (수 MB 인데 필요한 것이 없다)', () => {
  const acc = emptyTotals('s1', 'slug')
  const lines = [
    JSON.stringify({ type: 'attachment', huge: 'x'.repeat(100) }),
    JSON.stringify({ type: 'file-history-delta', huge: 'y'.repeat(100) }),
    JSON.stringify(A({ message: { model: 'm', usage: { output_tokens: 7 } } })),
  ].join('\n')
  foldLines(acc, lines)
  assert.equal(acc.assistantMsgs, 1)
  assert.equal(acc.byModel.m.output, 7)
})

test('깨진 줄은 건너뛰고 나머지를 접는다 (쓰는 중인 마지막 줄)', () => {
  const acc = emptyTotals('s1', 'slug')
  foldLines(acc, [
    JSON.stringify(A({ message: { model: 'm', usage: { output_tokens: 1 } } })),
    '{"type":"assistant", 깨진',
  ].join('\n'))
  assert.equal(acc.assistantMsgs, 1)
})

/* ── 할당량 해석 ─────────────────────────────────────────────── */

test('할당량 — 기록이 없으면 없다고 말한다', () => {
  const v = quotaView(null)
  assert.equal(v.exists, false)
  assert.match(v.desc, /기록 없음/)
})

test('🔴 할당량 — resetsAt 이 과거면 "이미 해제됨"이라고 말한다', () => {
  const past = Math.floor((Date.now() - 3600_000) / 1000)
  const v = quotaView({ status: 'rejected', resetsAt: past, rateLimitType: 'five_hour', _at: Date.now() - 7200_000 })
  assert.equal(v.alreadyLifted, true)
  assert.match(v.desc, /이미 해제/)
})

test('할당량 — 미래면 남은 시간을 말한다', () => {
  const future = Math.floor((Date.now() + 30 * 60_000) / 1000)
  const v = quotaView({ status: 'rejected', resetsAt: future, rateLimitType: 'five_hour', _at: Date.now() })
  assert.equal(v.alreadyLifted, false)
  assert.ok(v.liftInMin >= 29 && v.liftInMin <= 30)
})

test('할당량 — 초과사용 상태를 그대로 옮긴다', () => {
  const v = quotaView({
    status: 'rejected', resetsAt: 1, rateLimitType: 'five_hour',
    isUsingOverage: false, overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled',
    unifiedRateLimitFallbackAvailable: false, _at: Date.now(),
  })
  assert.equal(v.inOverage, false)
  assert.equal(v.overageBlockedWhy, 'org_level_disabled')
  assert.equal(v.canFallback, false)
})

test('🔴 할당량 — 기록 시각을 반드시 함께 준다 (지금 상태가 아닐 수 있다)', () => {
  const v = quotaView({ status: 'rejected', resetsAt: 1, _at: Date.now() - 60_000 })
  assert.ok(v.recordedAt, '기록 시각이 없으면 낡은 값을 현재로 오해한다')
  assert.ok(v.recordedMinAgo >= 1)
})

/* ── 끊긴 응답 (절전·네트워크 멎음) ──────────────────────────── */

/**
 * 🔴 이 도구는 절전을 **막는 데** 가장 공을 들였는데(pc.mjs · 설정 모달 · powercfg
 *   백업), 못 막아 잘린 세션은 재개 지점으로 쳐주지 않았다. 막으려던 사고가 났을 때
 *   정작 복구를 안 하는 셈이었다.
 *
 * 🔴 문구는 지어내지 않았다. 트랜스크립트 800파일·106,329줄에서 실측한 것이다.
 */
const synth = (t) => ({ model: '<synthetic>', content: t })
const REAL_INTERRUPT = 'API Error: The response stopped arriving. The response above may be incomplete.'

test('🔴 실측된 끊김 문구를 알아본다', () => {
  assert.equal(isInterruptedNotice(synth(REAL_INTERRUPT)), true)
  assert.equal(isInterruptedNotice(synth('Your computer went to sleep mid-response. The response above may be incomplete.')), true)
  assert.equal(isInterruptedNotice({ model: '<synthetic>', content: [{ type: 'text', text: REAL_INTERRUPT }] }), true,
    '블록 배열로 와도 읽어야 한다')
})

/**
 * 🔴 이 한 줄이 오탐을 통째로 막는다 — 화면을 긁는 도구들이 장식 걸러내기와
 *   툴출력 마스킹까지 만들어 푸는 문제를, 우리는 모델 필드 하나로 끝낸다.
 *   실측: `API Error: The response stopped arriving` 라는 글자는 **어시스턴트가 그
 *   오류를 설명하는 산문**에도 나왔다(claude-opus-5 로 기록됨). 그것을 "지금 끊겨
 *   있다"로 읽으면 멀쩡한 세션에 무인 재개를 띄운다.
 */
test('🔴 사람·어시스턴트가 그 오류를 **설명한 글**은 끊김이 아니다', () => {
  const prose = { model: 'claude-opus-5', content: `${REAL_INTERRUPT} — 출력이 너무 커서 깨진 것입니다. 3개로 쪼개겠습니다.` }
  assert.equal(isInterruptedNotice(prose), false, '<synthetic> 관문을 지나서 판정하면 안 된다')
  assert.equal(isInterruptedNotice({ model: undefined, content: REAL_INTERRUPT }), false)
  assert.equal(isLimitNotice({ model: 'claude-opus-5', content: "You've hit your session limit · resets 6pm" }), false)
})

test('모를 때는 끊김이라고 하지 않는다', () => {
  for (const m of [null, undefined, {}, synth(''), synth('정상 응답'), { model: '<synthetic>', content: 123 }]) {
    assert.equal(isInterruptedNotice(m), false, `${JSON.stringify(m)} 를 끊김으로 읽으면 안 된다`)
  }
})

test('🔴 제한과 끊김은 서로를 가리지 않는다', () => {
  assert.equal(isLimitNotice(synth(REAL_INTERRUPT)), false)
  assert.equal(isInterruptedNotice(synth("You've hit your session limit · resets 6pm (Asia/Seoul)")), false)
})

test('🔴 마지막 엔트리일 때만 "지금 끊겨 있다"다 (뒤에 답이 더 있으면 이어진 것이다)', () => {
  const acc = emptyTotals()
  foldEntry(acc, { type: 'assistant', message: synth(REAL_INTERRUPT) }, Date.now())
  assert.equal(acc.stoppedByInterrupt, true)
  foldEntry(acc, { type: 'assistant', message: { model: 'claude-opus-5', content: '이어서 답한다' } }, Date.now())
  assert.equal(acc.stoppedByInterrupt, false, '뒤에 정상 답이 오면 끊긴 상태가 아니다')
})

test('🔴 사람이 다시 입력했으면 끊긴 자리가 아니다', () => {
  const acc = emptyTotals()
  foldEntry(acc, { type: 'assistant', message: synth(REAL_INTERRUPT) }, Date.now())
  assert.equal(acc.stoppedByInterrupt, true)
  foldEntry(acc, { type: 'user', message: { content: '계속해' } }, Date.now())
  assert.equal(acc.stoppedByInterrupt, false, '사람이 이어서 쓰고 있으면 무인 재개가 끼어들면 안 된다')
})
