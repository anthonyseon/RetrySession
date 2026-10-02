/**
 * usage-panel.test.mjs — 맨 위 **사용량 패널을 정말 그려 본다.**
 *
 * 🔴 왜 소스 정규식으로 끝내지 않나
 *   이 저장소는 그 부류로 이미 다쳤다 — app.js 에 이름이 가려져 동작줄 단추 여섯 개가
 *   전부 `TypeError` 로 죽었는데, 그리기 시험과 소스 정규식은 **그것을 통과시켰다.**
 *   누르는 길과 그리는 길은 실제로 눌러 보고 그려 봐야 한다.
 *
 * 🔴 이 패널이 지켜야 하는 것 네 가지 (그래서 시험도 네 가지다)
 *   ① 접힌 채로는 읽지 않는다 — `/usage` 는 몇 초 걸린다(화면 뜨는 속도를 먹는다)
 *   ② 펼치면 한 번 읽고, 그 뒤로는 `갱신` 을 누를 때만 다시 읽는다
 *   ③ 못 읽은 것을 **0 으로 보여주지 않는다** (0 은 «안 쓰고 있다» 로 읽힌다)
 *   ④ 파싱이 깨지면 **원문을 남긴다** — 서식이 바뀐 날 사람이 읽을 유일한 자리다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareRender } from './_ui-harness.mjs'   // 🔴 전역 DOM 을 import 보다 먼저 깐다

const { cell } = prepareRender()
const { initUsage } = await import('../src/ui/usage.js')

/* ── 가짜 서버 ───────────────────────────────────────────────── */

let calls = []
let reply = null      // { ok, body } 또는 Error

globalThis.fetch = async (url) => {
  calls.push(String(url))
  if (reply instanceof Error) throw reply
  return { ok: reply.ok !== false, status: reply.status || 200, json: async () => reply.body }
}

/** 실측 모양 그대로 (2026-09-28 `/api/usage` 응답에서 가져왔다) */
const report = (over = {}) => ({
  at: '2026-09-28 17:14:26', fresh: false,
  account: { email: 'a@b.c', plan: 'max', ok: true, authMethod: 'claude.ai', isSubscription: true },
  claude: {
    ok: true, error: null, subscription: true, approximate: true,
    raw: 'Last 24h · 1,925 requests · 5 sessions',
    windows: [
      { label: 'Last 24h', requests: 1925, sessions: 5, traits: [{ percent: 98, what: 'of your usage was at >150k context' }], skills: ['/tests-verify 1%'] },
      { label: 'Last 7d', requests: 3770, sessions: 6, traits: [], skills: [] },
    ],
  },
  quota: {
    exists: true, type: 'five_hour', status: 'rejected', limited: false, leftMin: -224,
    resetsAt: '2026-09-28 13:30:00', usingOverage: false, overageStatus: 'rejected',
    overageDisabledReason: 'org_level_disabled', observedAt: '2026-09-28 13:12:34',
  },
  measured: {
    dayKey: '2026-09-28', sessionCount: 13,
    today: {
      tokens: 1_817_010_016, usd: 1261.6589, userMsgs: 2031, assistantMsgs: 3375, toolCalls: 1919,
      byModel: {
        '<synthetic>': { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0, usd: 0, estimated: false },
        'claude-opus-5': { input: 6736, cacheWrite1h: 28_709_117, cacheWrite5m: 0, cacheRead: 1_785_013_062, output: 3_281_101, usd: 1261.6589, estimated: false },
      },
    },
    total: {
      tokens: 6_420_069_717, usd: 4754.1304, userMsgs: 8663, assistantMsgs: 15125, toolCalls: 8095,
      byModel: {
        '<synthetic>': { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0, usd: 0, estimated: false },
        'claude-opus-5': { input: 30_108, cacheWrite1h: 116_108_959, cacheWrite5m: 0, cacheRead: 6_285_933_715, output: 17_996_935, usd: 4754.1304, estimated: false },
      },
    },
    costNote: '정가 환산 참고값 — 구독(max)이므로 실제 청구액이 아니다',
  },
  /**
   * 창 사용률 — **공식 퍼센트 + 우리 실측 토큰**(실측 응답 모양, 2026-09-29).
   * 🔴 퍼센트는 그쪽 값이고 토큰은 우리 값이다. 화면이 둘을 나누면 안 된다.
   */
  limits: [
    {
      key: 'session5h', label: 'Session (5hr)', pct: 9,
      resetsAt: '2026-09-29 17:59:59', resetsInMin: 290, severity: 'normal', lockedReason: null,
      measured: { tokens: 664_000_000, windowFrom: '2026-09-29 04:31:07', windowTo: '2026-09-29 09:31:07' },
    },
    {
      key: 'weekly7d', label: 'Weekly (7 day)', pct: 41,
      resetsAt: '2026-10-03 18:59:59', resetsInMin: 6110, severity: 'normal', lockedReason: null,
      measured: { tokens: 3_745_000_000, windowFrom: '2026-09-22 09:31:07', windowTo: '2026-09-29 09:31:07' },
    },
  ],
  officialOk: true, officialError: null, officialAt: '2026-09-29 10:43:27', tokenExpiresInMin: 205,
  ...over,
})

const box = () => cell.get('usageBox')
const digest = () => cell.get('usageDigest').textContent
const at = () => cell.get('usageAt').textContent
const body = () => cell.get('usageMain')
const text = () => body().textContent

/** 사람이 펼친다 — `<details>` 가 열리며 toggle 을 쏜다 */
async function open() {
  box().open = true
  box().fire('toggle')
  await new Promise((r) => setTimeout(r, 0))
}
/** 사람이 `갱신` 을 누른다 */
async function press() {
  cell.get('btnUsage').fire('click')
  await new Promise((r) => setTimeout(r, 0))
}

initUsage()

/* ── ① 접힌 채로는 읽지 않는다 ───────────────────────────────── */

test('🔴 열기 전에는 부르지 않는다 (/usage 는 몇 초 걸린다 — 화면 뜨는 속도를 먹는다)', () => {
  assert.equal(calls.length, 0, '기동만으로 /usage 를 부르면 화면이 그만큼 늦게 뜬다')
  assert.match(digest(), /펼치면 읽습니다/, '접힌 줄이 무엇을 하면 되는지 말해야 한다')
  assert.match(at(), /아직 읽지 않았습니다/, '«아직 안 읽었다» 와 «0 이다» 는 다른 사실이다')
})

/* ── ② 펼치면 한 번, 그 뒤엔 갱신할 때만 ─────────────────────── */

test('🔴 펼치면 한 번 읽고, 다시 펼쳐도 또 읽지 않는다', async () => {
  reply = { ok: true, body: report() }
  await open()
  assert.equal(calls.length, 1, '펼칠 때 한 번 읽어야 한다')
  assert.equal(calls[0], '/api/usage', '처음 읽기는 서버 캐시를 써도 된다 (fresh 아님)')
  box().open = false; box().fire('toggle')
  await open()
  assert.equal(calls.length, 1, '이미 읽었으면 다시 읽지 않는다 — 접었다 펴는 것은 갱신이 아니다')
})

/**
 * 🔴 접힌 줄의 맨 앞은 **창 사용률**이다(사용자 요청 2026-09-29). 사람이 가장 먼저 묻는
 *   것이 「얼마나 남았나」이고, 그 답이 곁눈질로 보이지 않으면 패널을 펼치게 된다.
 *   요청 수(Last 24h)는 본문으로 내렸다 — 한 줄에 다 넣으면 아무것도 읽히지 않는다.
 */
test('접힌 줄에 창 사용률·오늘 몫·제한 상태가 적힌다 (곁눈질로 보는 자리다)', () => {
  assert.match(digest(), /Session \(5hr\) 9%/, '5시간 창 사용률이 맨 앞이어야 한다')
  assert.match(digest(), /Weekly \(7 day\) 41%/, '주간도 함께 — 공식 값이다')
  assert.match(digest(), /오늘 토큰 1\.8B/, '오늘 토큰을 적어야 한다')
  assert.match(digest(), /\$1261\.66/, '오늘 정가를 적어야 한다')
  assert.match(digest(), /제한 없음/, '제한 상태가 없으면 이 패널의 쓸모가 반으로 준다')
})

/* ── 창 사용률: 공식 값을 그대로 ────────────────────────────── */

/**
 * 🔴 실측 결함 (사용자 지적 2026-09-29): 우리가 추정한 퍼센트가 실제와 크게 달랐다 —
 *   `/usage` 는 `Session 7% · Weekly 40%`, 우리 화면은 **100%**. 지금은 공식 값을 받아 쓴다.
 *   화면이 지켜야 하는 것: ① 그쪽 숫자를 그대로 ② 초기화 시각을 사람 말로
 *   ③ 우리 실측 토큰은 **참고**라고 적기(퍼센트의 분자가 아니다).
 */
test('🔴 공식 퍼센트를 그대로 적고, 우리 실측은 «참고» 라고 말한다', () => {
  assert.match(text(), /창 사용률 \(Claude 공식 값\)/, '출처가 제목에 있어야 한다')
  assert.match(text(), /Session \(5hr\)/, '그쪽에서 본 이름 그대로 적는다 — 사람이 찾을 수 있게')
  const pcts = body().querySelectorAll('span.wpct').map((x) => x.textContent)
  assert.deepEqual(pcts, ['9%', '41%'], '숫자에 군더더기를 붙이지 않는다(추정이 아니다)')
  assert.match(text(), /우리 실측 토큰 664.0M \(참고 · 굴러가는 창\)/, '단위가 달라 나누지 않는다고 말해야 한다')
  assert.match(text(), /단위가 달라 나누지 않습니다/, '왜 나누지 않는지 적어야 한다')
  assert.equal(body().querySelectorAll('div.meter').length, 2, '공식 값이 있는 창마다 막대를 그린다')
})

test('초기화 시각을 사람 말로 적는다 (6110분이 아니라 «4일 5시간 뒤»)', () => {
  assert.match(text(), /2026-09-29 17:59:59 초기화 \(4시간 50분 뒤\)/, '5시간 창')
  assert.match(text(), /2026-10-03 18:59:59 초기화 \(4일 5시간 뒤\)/, '주간 창')
})

test('🔴 공식 값을 못 받으면 «받지 못함» 이라 적고 이유를 보여준다 (실측으로 메우지 않는다)', async () => {
  reply = {
    ok: true,
    body: report({
      officialOk: false,
      officialError: '계정 토큰이 거부됐습니다(401) — Claude Code 를 한 번 열면 갱신됩니다',
      limits: [{
        key: 'session5h', label: 'Session (5hr)', pct: null, resetsAt: null, resetsInMin: null,
        severity: null, lockedReason: null,
        measured: { tokens: 664_000_000, windowFrom: 'x', windowTo: 'y' },
      }],
    }),
  }
  await press()
  assert.match(text(), /공식 사용률을 받지 못했습니다/, '무엇이 안 됐는지 말해야 한다')
  assert.match(text(), /401/, '이유를 그대로 남긴다')
  assert.match(text(), /`\/usage` 로 볼 수 있습니다/, '사람이 직접 볼 길을 알려줘야 한다')
  const pcts = body().querySelectorAll('span.wpct')
  assert.match(pcts[0].textContent, /받지 못함/)
  assert.ok(!/%/.test(pcts[0].textContent), `퍼센트 기호조차 없어야 한다: ${pcts[0].textContent}`)
  assert.equal(body().querySelectorAll('div.meter').length, 0, '모르는 값에 막대를 그리면 0% 로 읽힌다')
  assert.match(text(), /우리 실측 토큰 664.0M/, '실측은 그대로 보여준다(그건 우리가 아는 값이다)')
  assert.match(digest(), /Session \(5hr\) \?/, '접힌 줄에서도 «?» 다')
})

test('세 출처를 갈라서 그린다 — 근사값(/usage) · 관측 기록(제한) · 우리 실측', () => {
  assert.match(text(), /Claude 가 말하는 사용량/, '/usage 묶음이 있어야 한다')
  assert.match(text(), /근사값입니다/, '🔴 그쪽이 붙인 한정 조건을 지우면 근사가 실측처럼 보인다')
  assert.match(text(), /사용량 제한/, '제한 묶음이 있어야 한다')
  assert.match(text(), /그 시각에 관측한 기록/, '🔴 관측 시점의 값이라고 말해야 한다')
  assert.match(text(), /우리 실측/, '실측 묶음이 있어야 한다')
  assert.match(text(), /오늘 \(2026-09-28\)/, '오늘은 로컬 자정 기준의 날짜를 적는다')
  assert.match(text(), /누적/, '누적을 함께 적어야 «오늘 이하» 를 눈으로 본다')
  assert.match(text(), /구독\(max\)이므로 실제 청구액이 아니다/, '정가 환산이라는 말을 함께 둔다')
})

test('모델별은 오늘·누적을 한 줄에 두고, 둘 다 0 인 모델은 빼놓는다', () => {
  assert.match(text(), /claude-opus-5/, '쓴 모델은 나와야 한다')
  assert.ok(!text().includes('<synthetic>'),
    '오늘도 누적도 0 인 자리표시자는 줄만 차지한다')
  // 한 줄에 오늘과 누적이 같이 있어야 «오늘 ≤ 누적» 이 눈에 보인다
  const head = text()
  for (const h of ['오늘 토큰', '오늘 정가', '누적 토큰', '누적 정가']) {
    assert.ok(head.includes(h), `표 머리에 ${h} 가 있어야 한다`)
  }
})

test('🔴 갱신 단추는 fresh=1 로 읽는다 (서버 캐시를 건너뛴다)', async () => {
  reply = { ok: true, body: report({ fresh: true }) }
  // 🔴 절대 호출 수로 세지 않는다 — 앞에 시험을 하나 끼우면 깨지는 시험은 계약을 지키지 못한다
  const before = calls.length
  await press()
  assert.equal(calls.length, before + 1, '누르면 다시 읽어야 한다')
  assert.equal(calls.at(-1), '/api/usage?fresh=1', '캐시를 건너뛰지 않으면 «갱신» 이 거짓말이 된다')
  assert.match(at(), /지금 읽은 값/, '지금 값인지 캐시인지 말해야 한다')
})

/* ── ③ 못 읽은 것을 0 으로 보여주지 않는다 ───────────────────── */

test('🔴 읽기가 실패하면 그렇게 말한다 — 0 으로 그리지 않는다', async () => {
  reply = new Error('서버가 죽었다')
  await press()
  assert.match(digest(), /읽지 못했습니다/, '접힌 줄도 실패를 말해야 한다')
  assert.match(text(), /▲ 사용량을 읽지 못했습니다 — 서버가 죽었다/, '이유를 적어야 한다')
  assert.ok(!text().includes('$0.00'), '🔴 못 읽은 것을 0 으로 보여주면 «안 쓰고 있다» 로 읽힌다')
})

test('HTTP 오류도 같은 자리에서 말한다 (조용히 옛 값을 남기지 않는다)', async () => {
  reply = { ok: false, status: 500, body: null }
  await press()
  assert.match(text(), /HTTP 500/, '상태 코드를 적어야 한다 — 이유 없는 실패는 고칠 수 없다')
})

/* ── ④ 파싱이 깨지면 원문을 남긴다 ───────────────────────────── */

test('🔴 /usage 의 숫자를 못 뽑았으면 원문을 그대로 보여준다', async () => {
  reply = {
    ok: true,
    body: report({ claude: { ok: true, error: null, approximate: false, windows: [], raw: '무언가 새 서식' } }),
  }
  await press()
  assert.match(text(), /서식이 바뀐 것으로 보입니다/, '파싱 실패를 말해야 한다')
  assert.match(text(), /원문 보기/, '원문을 접어서라도 둬야 한다')
  assert.match(text(), /무언가 새 서식/, '🔴 원문이 없으면 그날 사람은 아무것도 못 본다')
})

test('/usage 자체를 못 불렀을 때도 우리 실측은 계속 보여준다 (출처가 다르다)', async () => {
  reply = {
    ok: true,
    body: report({ claude: { ok: false, error: '시간이 초과됐다', windows: [], raw: '' } }),
  }
  await press()
  assert.match(text(), /\/usage 를 읽지 못했습니다 — 시간이 초과됐다/, '왜 못 읽었는지 적어야 한다')
  assert.match(text(), /우리 실측/, '한 출처가 실패해도 다른 출처는 그려야 한다')
  assert.match(text(), /오늘 \(2026-09-28\)/, '실측은 CLI 와 무관하다 — 함께 죽으면 안 된다')
})

test('제한 중이면 접힌 줄에서 바로 보인다 (남은 시간까지)', async () => {
  reply = {
    ok: true,
    body: report({ quota: { exists: true, limited: true, leftMin: 42, type: 'five_hour', status: 'rejected' } }),
  }
  await press()
  assert.match(digest(), /제한 중 \(42분 남음\)/, '제한은 접힌 줄에서 보여야 한다')
  assert.match(text(), /제한 중 — 42분 남음/, '펼친 곳에도 남은 시간을 적는다')
})

test('제한 기록이 아예 없을 때 «0» 이 아니라 «기록 없음» 이라 말한다', async () => {
  reply = { ok: true, body: report({ quota: { exists: false, why: '아직 제한에 걸린 기록이 없다' } }) }
  await press()
  assert.match(digest(), /제한 기록 없음/, '모르는 것과 없는 것을 갈라 말해야 한다')
  assert.match(text(), /아직 제한에 걸린 기록이 없다/, '서버가 준 이유를 그대로 적는다')
})

/**
 * 🔴 기준선의 **출처**가 백분율의 뜻을 바꾼다 (실측 2026-09-29).
 *   주간 기준선을 11일 전 사건에서 배우자 215% 가 떴는데 제한에 걸려 있지 않았다 —
 *   그러면 기준선을 「제한 없이 넘긴 최대 창」으로 올린다(lib/limit-window.reconcileBaseline).
 *   그때 100% 는 «한도에 닿았다» 가 아니라 «우리 최고 기록» 이다. 화면이 그렇게 말해야 하고,
 *   **경고색을 주면 안 된다** — 위험이 아닌 것에 빨강을 쓰면 진짜 경고가 묻힌다.
 */
/**
 * 🔴 색의 기준을 **우리가 발명하지 않는다.** 그쪽이 `severity` 를 함께 주므로 그것을 따르고,
 *   없을 때만 퍼센트로 정한다(70·90%). 위험하지 않은 것에 빨강을 쓰면 진짜 경고가 묻힌다 —
 *   이 저장소가 반복해 고쳐 온 부류다.
 */
test('🔴 색은 그쪽이 준 severity 를 따른다 (경고 기준을 우리가 새로 만들지 않는다)', async () => {
  reply = {
    ok: true,
    body: report({
      limits: [
        { key: 'session5h', label: 'Session (5hr)', pct: 12, resetsAt: null, resetsInMin: null, severity: 'critical', lockedReason: null, measured: null },
        { key: 'weekly7d', label: 'Weekly (7 day)', pct: 95, resetsAt: null, resetsInMin: null, severity: 'normal', lockedReason: null, measured: null },
      ],
    }),
  }
  await press()
  const [a, b] = body().querySelectorAll('span.wpct')
  assert.match(String(a.className), /crit/, '12% 여도 그쪽이 critical 이라면 critical 이다')
  assert.ok(!/crit|warn/.test(String(b.className)), '95% 여도 그쪽이 normal 이라면 경고색을 주지 않는다')
})

test('제한이 잠긴 이유가 오면 그대로 보여준다 (우리가 고칠 수 없는 것은 그쪽 말을 옮긴다)', async () => {
  reply = {
    ok: true,
    body: report({
      limits: [{ key: 'session5h', label: 'Session (5hr)', pct: 100, resetsAt: null, resetsInMin: null, severity: 'critical', lockedReason: 'usage_limit_reached', measured: null }],
    }),
  }
  await press()
  assert.match(text(), /usage_limit_reached/)
})
