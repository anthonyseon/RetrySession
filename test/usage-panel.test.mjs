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

test('접힌 줄에 오늘 몫·요청 수·제한 상태가 적힌다 (곁눈질로 보는 자리다)', () => {
  assert.match(digest(), /오늘 토큰 1\.8B/, '오늘 토큰을 적어야 한다')
  assert.match(digest(), /\$1261\.66/, '오늘 정가를 적어야 한다')
  assert.match(digest(), /최근 24시간 요청 1,925 · 세션 5/, '`Last 24h` 는 우리 말로 옮긴다')
  assert.match(digest(), /제한 없음/, '제한 상태가 없으면 이 패널의 쓸모가 반으로 준다')
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
  await press()
  assert.equal(calls.length, 2, '누르면 다시 읽어야 한다')
  assert.equal(calls[1], '/api/usage?fresh=1', '캐시를 건너뛰지 않으면 «갱신» 이 거짓말이 된다')
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
