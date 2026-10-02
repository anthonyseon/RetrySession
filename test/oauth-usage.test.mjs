/**
 * oauth-usage.test.mjs — **공식 사용률을 받아 오는 길.**
 *
 * 🔴 왜 이 길이 생겼나 (사용자 지적 2026-09-29)
 *   우리가 추정한 백분율이 실제와 크게 달랐다 — `/usage` 화면은 `Session 7% · Weekly 40%`,
 *   우리 화면은 **100%**. 추정을 고치는 대신 **공식 값을 받는다**: 대화 화면이 쓰는 그 자리
 *   (`GET /api/oauth/usage`)를 로그인된 계정 토큰으로 부른다.
 *
 * 🔴 문서에 없는 자리다. 그래서 두 가지를 시험으로 못박는다:
 *   ① **깨지면 깨졌다고 말한다** — 파일 없음·만료·401·서식 변경 각각 «못 받았다 + 이유».
 *      숫자를 지어내면 사람이 그 숫자로 일을 계획한다(이 저장소가 가장 싫어하는 부류).
 *   ② **토큰이 새지 않는다** — 보내는 곳은 한 군데(api.anthropic.com)이고, 돌려주는 값·
 *      오류 문구에 토큰이 섞이지 않는다. 로그·상태 파일에도 남지 않는다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOfficial, readToken, officialUsage, resetOfficialCache, OFFICIAL_WINDOWS } from '../src/lib/oauth-usage.mjs'

/** 실측 응답 그대로 (2026-09-29 `GET /api/oauth/usage`) */
const REAL = {
  five_hour: { utilization: 9, resets_at: '2026-09-29T09:00:00.005315+00:00', limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
  seven_day: { utilization: 40, resets_at: '2026-10-03T10:00:00.005336+00:00', limit_dollars: null, used_dollars: null, remaining_dollars: null, locked_reason: null },
  seven_day_opus: null,
  extra_usage: { is_enabled: false, utilization: null },
  limits: [
    { kind: 'session', group: 'session', percent: 9, severity: 'normal', resets_at: '2026-09-29T09:00:00.005315+00:00', is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 40, severity: 'normal', resets_at: '2026-10-03T10:00:00.005336+00:00', is_active: true },
  ],
}

const TOKEN = 'oauth-token-' + 'x'.repeat(90)
const creds = (over = {}) => JSON.stringify({
  claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3600_000, subscriptionType: 'max', rateLimitTier: 'default_claude_max_5x', ...over },
})

function withCred(body) {
  const dir = mkdtempSync(join(tmpdir(), 'rs-cred-'))
  const f = join(dir, '.credentials.json')
  writeFileSync(f, body, 'utf8')
  return { file: f, clean: () => rmSync(dir, { recursive: true, force: true }) }
}

/* ── 해석 (순수 함수) ───────────────────────────────────────── */

test('🔴 실측 응답에서 두 창의 퍼센트와 초기화 시각을 뽑는다', () => {
  const w = parseOfficial(REAL, Date.parse('2026-09-29T08:00:00Z'))
  assert.equal(w.length, 2)
  assert.deepEqual(w.map((x) => [x.label, x.pct]), [['Session (5hr)', 9], ['Weekly (7 day)', 40]])
  assert.match(w[0].resetsAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '사람이 읽는 시각으로 옮긴다')
  assert.equal(w[0].resetsInMin, 60, '남은 시간을 분으로 준다')
})

test('🔴 사용률 칸이 없는 창은 **만들지 않는다** (0 으로 채우면 「여유 있다」가 거짓이 된다)', () => {
  assert.deepEqual(parseOfficial({ five_hour: null, seven_day: null }), [])
  assert.deepEqual(parseOfficial({ five_hour: { utilization: null } }), [])
  assert.deepEqual(parseOfficial({}), [])
  assert.deepEqual(parseOfficial(null), [])
})

test('초기화 시각이 없거나 깨졌어도 퍼센트는 살린다 (한쪽이 없다고 둘을 버리지 않는다)', () => {
  const [w] = parseOfficial({ five_hour: { utilization: 55, resets_at: 'not-a-date' } })
  assert.equal(w.pct, 55)
  assert.equal(w.resetsAt, null)
  assert.equal(w.resetsInMin, null)
})

test('그쪽이 준 severity 를 그대로 들고 온다', () => {
  const [w] = parseOfficial({ five_hour: { utilization: 95 }, limits: [{ percent: 95, severity: 'critical' }] })
  assert.equal(w.severity, 'critical')
})

test('창 이름은 `/usage` 화면의 말 그대로다', () => {
  assert.deepEqual(OFFICIAL_WINDOWS.map((w) => w.label), ['Session (5hr)', 'Weekly (7 day)'])
})

/* ── 토큰 읽기: fail-closed ─────────────────────────────────── */

test('🔴 로그인 파일이 없으면 «로그인하세요» 라고 말한다 (조용히 0 을 보여주지 않는다)', () => {
  const r = readToken(join(tmpdir(), '없는-자격증명-rs.json'))
  assert.equal(r.ok, false)
  assert.match(r.why, /로그인/)
})

test('🔴 만료된 토큰으로는 부르지 않는다 (401 을 받아 오는 것보다 미리 말하는 편이 쓸모 있다)', () => {
  const c = withCred(creds({ expiresAt: Date.now() - 60_000 }))
  const r = readToken(c.file)
  assert.equal(r.ok, false)
  assert.match(r.why, /만료/)
  assert.ok(!JSON.stringify(r).includes(TOKEN), '🔴 오류 문구에 토큰이 섞이면 안 된다')
  c.clean()
})

test('토큰이 살아 있으면 요금제·티어도 함께 준다 (화면이 무엇으로 도는지 말할 수 있게)', () => {
  const c = withCred(creds())
  const r = readToken(c.file)
  assert.equal(r.ok, true)
  assert.equal(r.plan, 'max')
  assert.equal(r.tier, 'default_claude_max_5x')
  c.clean()
})

/* ── 부르기: 계약과 실패 ───────────────────────────────────── */

test('🔴 보내는 곳은 api.anthropic.com 한 군데이고, 토큰은 헤더로만 간다', async () => {
  resetOfficialCache()
  const c = withCred(creds())
  const seen = []
  const fetchImpl = async (url, opt) => {
    seen.push({ url, headers: opt.headers })
    return { ok: true, status: 200, text: async () => JSON.stringify(REAL) }
  }
  const r = await officialUsage({ fresh: true, file: c.file, fetchImpl })
  assert.equal(seen.length, 1, '한 번만 부른다')
  assert.equal(seen[0].url, 'https://api.anthropic.com/api/oauth/usage')
  assert.equal(seen[0].headers.Authorization, `Bearer ${TOKEN}`)
  assert.ok(!seen[0].url.includes(TOKEN), '🔴 토큰을 URL 에 넣으면 기록·프록시에 남는다')
  assert.equal(r.ok, true)
  assert.equal(r.windows[1].pct, 40)
  assert.ok(!JSON.stringify(r).includes(TOKEN), '🔴 돌려주는 값에 토큰이 섞이면 화면·로그로 흐른다')
  c.clean()
})

test('🔴 401 이면 갱신 방법을 말한다 (숫자를 만들지 않는다)', async () => {
  resetOfficialCache()
  const c = withCred(creds())
  const r = await officialUsage({
    fresh: true, file: c.file,
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'unauthorized' }),
  })
  assert.equal(r.ok, false)
  assert.deepEqual(r.windows, [])
  assert.match(r.error, /401/)
  assert.match(r.error, /Claude Code 를 한 번 열면/, '사람이 할 일을 말해야 한다')
  c.clean()
})

test('🔴 그물이 끊기면 그렇게 말한다 (0% 로 보여주지 않는다)', async () => {
  resetOfficialCache()
  const c = withCred(creds())
  const r = await officialUsage({
    fresh: true, file: c.file,
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND') },
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /받지 못했습니다/)
  assert.match(r.error, /ENOTFOUND/, '원인을 그대로 남긴다')
  c.clean()
})

test('🔴 서식이 바뀌면 «해석할 수 없다» 고 말한다', async () => {
  resetOfficialCache()
  const c = withCred(creds())
  const bad = await officialUsage({ fresh: true, file: c.file, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<html>' }) })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /해석할 수 없습니다/)

  resetOfficialCache()
  const empty = await officialUsage({ fresh: true, file: c.file, fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"hello":1}' }) })
  assert.equal(empty.ok, false)
  assert.match(empty.error, /사용률 칸이 없습니다/)
  c.clean()
})

test('캐시는 60초 — 화면이 3초마다 불러도 그쪽을 두드리지 않는다', async () => {
  resetOfficialCache()
  const c = withCred(creds())
  let calls = 0
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, text: async () => JSON.stringify(REAL) } }
  await officialUsage({ fresh: true, file: c.file, fetchImpl })
  await officialUsage({ file: c.file, fetchImpl })
  assert.equal(calls, 1, '두 번째는 캐시다')
  const again = await officialUsage({ fresh: true, file: c.file, fetchImpl })
  assert.equal(calls, 2, '`갱신` 은 캐시를 건너뛴다')
  assert.equal(again.cached, false)
  c.clean()
})
