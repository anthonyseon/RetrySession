/**
 * ui-actions.test.mjs — 단추를 **실제로 눌러 본다.**
 *
 * 🔴 왜 이게 있어야 하나 (실측 결함, 2026-09-22)
 *   이름을 영어로 바꾸는 과정에서 app.js 안에 `meta` 가 **둘** 생겼다 —
 *   세션 정보를 만드는 함수와 그 결과를 담는 그릇. 안쪽 `const meta = {}` 가
 *   바깥 함수를 가려서 동작줄의 단추 **여섯 개가 전부** 다음으로 터졌다:
 *
 *     TypeError: meta is not a function
 *
 *   요청은 하나도 나가지 않았다. 그런데 오류는 콘솔에만 남고 화면은 조용했다 —
 *   눌렀는데 아무 일도 안 일어나는, 사람이 가장 알아채기 어려운 고장이다.
 *   감시를 켠 줄 알았는데 안 켜져 있으면 이 도구는 있으나 마나다.
 *
 *   있던 시험들이 왜 못 잡았나: 소스 정규식(“post 를 부르나”)과 **그리기**만 봤다.
 *   그리기는 멀쩡했다. 깨진 것은 **누르는 길**이었고 아무도 눌러 보지 않았다.
 *   그래서 여기서는 진짜로 누르고, **나간 요청을 본다.**
 *
 * 🔴 fetch·타이머를 먼저 가짜로 바꾼 뒤에 app.js 를 가져온다.
 *   app.js 는 가져오는 순간 폴링을 걸고 첫 상태를 읽는다. 순서를 바꾸면 진짜
 *   서버로 나가고 시험이 환경에 매달린다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareRender } from './_ui-harness.mjs'

const { cell } = prepareRender()

globalThis.setInterval = () => 0
globalThis.setTimeout = () => 0
globalThis.alert = () => { }
globalThis.confirm = () => true          // 확인 창은 "예"로 답한 셈 친다

const ID = 'aaaaaaaa-1111-2222-3333-444444444444'
const sample = {
  at: '2026-09-22 00:00:00', scan: { ms: 1 }, alerts: [], sessions: [],
  account: { ok: true, email: 'a@b.c', subscriptionType: 'max' },
  totals: { sessionCount: 0, running: 0, runKnown: true, watchOn: 0, restartOn: 0, foldersNoSession: 0, bypassSessions: 0, totalTokens: 0, totalUSD: 0 },
  tasks: {}, processes: { ok: true, items: [], orphans: [] }, ide: { windows: [], liveWindows: 0, staleLocks: 0, folders: [] },
  quota: { exists: false }, pc: null,
}

const sent = []
globalThis.fetch = async (url, opt) => {
  sent.push({ url: String(url), method: opt?.method || 'GET', body: opt?.body ? JSON.parse(opt.body) : null })
  return { ok: true, status: 200, json: async () => (String(url).startsWith('/api/status') ? sample : { ok: true }) }
}

const { S } = await import('../src/ui/common.js')
await import('../src/ui/app.js')

const session = { sessionId: ID, title: '제목', runCwd: 'c:\\w', mainCwd: 'c:\\w', slug: 'sl' }

/** 단추 하나를 누르고 **나간 POST** 만 돌려준다 */
async function press(act) {
  S.state = { ...sample, sessions: [session] }
  S.picked = new Set([ID])
  sent.length = 0
  const bar = cell.get('.actions')
  bar.dataset.act = act
  await bar._on.click({ target: bar })
  return sent.filter((x) => x.method === 'POST')
}

const cases = [
  ['watch-on', '/api/targets', { watch: true }],
  ['watch-off', '/api/targets', { watch: false }],
  ['resume-on', '/api/targets', { restart: true }],
  ['resume-off', '/api/targets', { restart: false }],
  ['rearm', '/api/rearm', null],
  ['remove', '/api/targets/remove', null],
]

for (const [act, path, patch] of cases) {
  test(`🔴 [${act}] 단추가 실제로 요청을 보낸다 (조용히 죽지 않는다)`, async () => {
    const posts = await press(act)
    assert.ok(posts.length > 0, `${act} 가 아무것도 보내지 않았다 — 눌러도 아무 일이 없는 화면이다`)
    assert.equal(posts[0].url, path)
    assert.deepEqual(posts[0].body.sessionIds, [ID])
    if (patch) for (const [k, v] of Object.entries(patch)) assert.equal(posts[0].body[k], v, `${act} 의 ${k}`)
  })
}

test('🔴 감시·재시작을 켤 때 세션 정보를 함께 보낸다 (등록부가 빈 껍데기가 되면 안 된다)', async () => {
  const [p] = await press('watch-on')
  assert.ok(p.body.meta, 'meta 가 없다')
  assert.deepEqual(p.body.meta[ID], { title: '제목', runCwd: 'c:\\w', mainCwd: 'c:\\w', slug: 'sl' },
    '세션마다 제목·경로가 담겨야 한다 — 이것이 비면 목록이 이름 없는 줄로 남는다')
})

test('고른 것이 없으면 아무것도 보내지 않는다', async () => {
  S.state = { ...sample, sessions: [session] }
  S.picked = new Set()
  sent.length = 0
  const bar = cell.get('.actions')
  bar.dataset.act = 'watch-on'
  await bar._on.click({ target: bar })
  assert.equal(sent.filter((x) => x.method === 'POST').length, 0)
})

test('모르는 동작이면 아무것도 보내지 않는다', async () => {
  const posts = await press('no-such-action')
  assert.equal(posts.length, 0)
})
