/**
 * auth.test.mjs — 로그인이 끊긴 것은 **우리 실패가 아니다.** 대신 반드시 말해야 한다.
 *
 * 🔴 왜 따로 있나 — 실측 결함 (2026-09-28, 전수 재검증)
 *   이 저장소의 **첫 실제 자율 재개**가 이렇게 끝났다:
 *     `RUN 끝 · fail · 5초 · $0 · 턴 1 · exit 1`
 *     `Failed to authenticate: OAuth session expired and could not be refreshed`
 *   재 보니 isLimitFailure·isTransientFailure 둘 다 false → 'fail' → 세 번이면 차단.
 *   그런데 몇 분 뒤 `claude auth status` 는 정상이었다(토큰이 갱신됐다).
 *   **저절로 낫는 일에 차단기를 태우고 사람에게 --rearm 을 시킨다** — 제한·과부하에서
 *   이미 두 번 고친 실패 방식의 세 번째 얼굴이다.
 *
 *   그리고 경보가 **하나도 없었다.** 차단하지 않기로 했으면 말은 해야 한다 —
 *   안 그러면 재개가 15분마다 조용히 헛돈다(겉은 조용, 속은 멎음).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAuthFailure, isTransientFailure, isLimitFailure, classifyRun, isOutdatedFailure, outdatedVersions,
} from '../src/lib/classify.mjs'
import { recordRun, emptyState } from '../src/lib/guard.mjs'
import { dayKey } from '../src/lib/stamp.mjs'
import { currentAlerts } from '../src/lib/alerts.mjs'

/** 실측된 문구 그대로 — 지어낸 문구로 시험하면 진짜를 못 잡는다 */
const REAL = 'Failed to authenticate: OAuth session expired and could not be refreshed'

test('🔴 실측된 인증 실패 문구를 알아본다', () => {
  assert.equal(isAuthFailure(REAL), true, '2026-09-28 실측 문구를 못 알아본다')
  // 이 둘이 못 잡아서 'fail' 이 됐다 — 그 사실도 함께 고정한다
  assert.equal(isLimitFailure(REAL), false)
  assert.equal(isTransientFailure(REAL), false)
})

test('인증이 끊긴 다른 얼굴들도 알아본다', () => {
  for (const s of [
    'API Error: 401 authentication_error',
    'OAuth token has expired',
    'refresh token revoked',
    'You are not logged in — run /login',
    'No credentials found',
    'Invalid API key',
    'Please run claude login',
  ]) {
    assert.equal(isAuthFailure(s), true, `${s} 는 인증 실패다`)
  }
})

test('🔴 인증이 아닌 것을 인증이라고 하지 않는다 (고쳐야 낫는 것을 기다리면 안 된다)', () => {
  for (const s of ['', null, undefined,
    'API Error: 403 Forbidden',            // 권한이지 인증이 아니다 — 기다려도 안 낫는다
    'API Error: 529 Overloaded',
    'API Error: 400 tools.11.custom.input_schema.properties',
    'No conversation found with session ID: …',
    'Claude usage limit reached',
  ]) {
    assert.equal(isAuthFailure(s), false, `${JSON.stringify(s)} 를 인증 실패로 읽으면 안 된다`)
  }
})

test('🔴 401 은 지나가는 실패가 아니라 인증 실패로 갈라져야 한다', () => {
  // isTransientFailure 는 401 을 영구 오류로 배제한다(그게 맞다 — 재시도로 안 풀리는 것이
  // 많다). 그래서 인증 칸이 401 의 유일한 출구다. 없으면 'fail' 로 떨어져 차단기를 태운다.
  assert.equal(isTransientFailure('API Error: 401'), false)
  assert.equal(isAuthFailure('API Error: 401'), true)
})

/* ── 판정 순서 ───────────────────────────────────────────────── */

/**
 * 🔴 순서가 곧 판정이다. 이 연쇄는 resume.mjs 안의 삼항식으로만 있어서 **시험이
 *   닿지 않았다** — 그래서 classify.classifyRun 으로 떼어내고 여기서 고정한다.
 */
test('🔴 인증 칸이 없으면 401 은 fail 로 떨어져 차단기를 태운다', () => {
  // isTransientFailure 가 401 을 영구 오류로 배제하므로(그게 맞다) 인증 칸이 유일한 출구다
  assert.equal(classifyRun({ failed: true, label: 'API Error: 401 authentication_error' }), 'auth')
  assert.equal(classifyRun({ failed: true, label: REAL }), 'auth')
  assert.equal(classifyRun({ failed: true, label: 'API Error: 529 Overloaded' }), 'overload')
})

test('5xx 와 인증 문구가 함께 오면 인증으로 본다 (조용한 재시도보다 말하는 쪽)', () => {
  assert.equal(classifyRun({ failed: true, label: 'API Error: 503 Service Unavailable — Failed to authenticate' }),
    'auth', '순서를 뒤집으면 로그인이 끊긴 것을 과부하로 읽고 아무 말도 하지 않는다')
})

test('🔴 타임아웃이 가장 먼저다 — 30분을 실제로 돌았다는 뜻이다', () => {
  assert.equal(classifyRun({ timedOut: true, failed: true, label: REAL }), 'timeout',
    '타임아웃을 인증으로 읽으면 진짜로 오래 걸린 작업이 조용히 넘어간다')
})

test('제한이 인증보다 먼저다 (둘 다 섞여 있으면 기다리는 쪽으로)', () => {
  assert.equal(classifyRun({ failed: true, label: 'Claude usage limit reached · Failed to authenticate' }), 'limited')
})

test('성공과 알 수 없는 실패는 그대로', () => {
  assert.equal(classifyRun({ failed: false, label: REAL }), 'ok', '실패가 아니면 문구를 보지 않는다')
  assert.equal(classifyRun({ failed: true, label: '알 수 없는 오류' }), 'fail', '모르는 실패만 차단기를 태운다')
  assert.equal(classifyRun(), 'ok', '인자가 없어도 던지지 않는다')
})

test('🔴 인증 실패는 연속실패를 올리지 않는다 (차단기를 태우지 않는다)', () => {
  let st = emptyState()
  for (let i = 0; i < 5; i++) st = recordRun(st, { result: 'auth', summary: REAL }, { failStreakMax: 3 })
  assert.equal(st.failStreak, 0, '인증 실패 다섯 번에 차단되면 안 된다 — 로그인이 살아나면 될 일이다')
  assert.equal(st.blocked, null)
})

test('🔴 그렇다고 연속실패를 0 으로 되돌리지도 않는다', () => {
  let st = emptyState()
  st = recordRun(st, { result: 'fail', summary: 'x' }, { failStreakMax: 3 })
  st = recordRun(st, { result: 'fail', summary: 'x' }, { failStreakMax: 3 })
  st = recordRun(st, { result: 'auth', summary: REAL }, { failStreakMax: 3 })
  assert.equal(st.failStreak, 2, '인증이 끼었다고 진짜 실패 두 번이 지워지면 안 된다')
  st = recordRun(st, { result: 'fail', summary: 'x' }, { failStreakMax: 3 })
  assert.ok(st.blocked, '세 번째 진짜 실패에서는 차단돼야 한다')
})

test('인증 실패도 세기는 센다 (몇 번 헛돌았는지 모르면 왜 안 도는지 안 보인다)', () => {
  let st = emptyState()
  st = recordRun(st, { result: 'auth', summary: REAL }, {})
  st = recordRun(st, { result: 'auth', summary: REAL }, {})
  const today = Object.keys(st.authByDay)[0]
  assert.equal(st.authByDay[today], 2)
  assert.equal(Object.values(st.byDay)[0], 2, '하루 횟수에도 센다 — 프로세스를 띄웠다')
  assert.deepEqual(st.overloadByDay, {}, '과부하 칸을 함께 올리면 안 된다')
})

test('과부하 기록과 인증 기록이 서로를 지우지 않는다', () => {
  let st = emptyState()
  st = recordRun(st, { result: 'overload', summary: '529' }, {})
  st = recordRun(st, { result: 'auth', summary: REAL }, {})
  const today = Object.keys(st.byDay)[0]
  assert.equal(st.overloadByDay[today], 1)
  assert.equal(st.authByDay[today], 1)
})

/* ── 경보 ────────────────────────────────────────────────────── */

const base = (o = {}) => ({ sessions: [], tasks: {}, quota: { exists: false }, locks: {}, ...o })
const codes = (d) => currentAlerts(d).map((a) => a.code)

test('🔴 로그아웃이 확실하면 치명 경보 — 이 도구의 전제가 사라진 상태다', () => {
  const a = currentAlerts(base({ account: { ok: false, loggedIn: false, error: null } }))
  const hit = a.find((x) => x.code === '로그인끊김')
  assert.ok(hit, 'API 키를 쓰지 않으므로 로그인이 없으면 재개가 한 번도 못 돈다')
  assert.equal(hit.level, 'critical')
  assert.match(hit.desc, /로그인/, '무엇을 하라는 것인지 적어야 한다')
})

test('🔴 조회만 실패한 것은 경고다 (타임아웃 한 번에 "끊겼다"고 외치면 거짓 경보다)', () => {
  const a = currentAlerts(base({ account: { ok: false, loggedIn: false, error: '시간 초과(20초)' } }))
  assert.deepEqual(codes(base({ account: { ok: false, loggedIn: false, error: 'x' } })).includes('로그인끊김'), false)
  const hit = a.find((x) => x.code === '계정조회실패')
  assert.ok(hit, '모르는 것도 말해야 한다 — 다만 수준이 다르다')
  assert.equal(hit.level, 'warning')
  assert.match(hit.desc, /시간 초과/, '왜 못 봤는지 적어야 조치할 수 있다')
})

test('로그인이 멀쩡하면 계정 경보가 없다', () => {
  assert.deepEqual(codes(base({ account: { ok: true, loggedIn: true, email: 'a@b.c' } })), [])
})

test('계정 정보가 아예 없는 옛 데이터로도 터지지 않는다', () => {
  assert.doesNotThrow(() => currentAlerts(base()))
  assert.deepEqual(codes(base()), [])
})

const sess = (restart) => ({
  sessionId: 's1', shortId: 's1', title: '테스트 세션',
  watch: { on: false }, tracker: {}, restart,
})

test('🔴 재개가 로그인 때문에 헛돌면 한 번부터 알린다 (과부하는 세 번부터지만 이건 다르다)', () => {
  const d = base({ sessions: [sess({ on: true, authToday: 1, lastRun: { result: 'auth', at: '2026-09-28 08:33:19' } })] })
  const hit = currentAlerts(d).find((x) => x.code === '인증실패')
  assert.ok(hit, '차단하지 않으므로 말하지 않으면 아무도 모른다')
  assert.equal(hit.level, 'warning', '기다리면 풀릴 수도 있다 — 치명은 로그아웃이 확실할 때다')
  assert.equal(hit.target, 's1', '눌러서 그 세션으로 갈 수 있어야 한다')
  assert.match(hit.desc, /08:33:19/, '언제였는지 적어야 한다')
})

test('🔴 이미 지나간 인증 실패로 계속 외치지 않는다 (봐주기의 반대쪽 — 늑대 외치기)', () => {
  // 오늘 한 번 끊겼지만 그 뒤 실행이 성공했다 → 열려 있는 문제가 아니다
  const ok = base({ sessions: [sess({ on: true, authToday: 1, lastRun: { result: 'ok', at: 'x' } })] })
  assert.deepEqual(codes(ok), [], '성공으로 넘어간 뒤에도 외치면 진짜 경고가 묻힌다')
  // 어제 끊겼고 오늘은 아직 실행이 없다 → 오늘 몫이 0 이므로 조용하다
  const old = base({ sessions: [sess({ on: true, authToday: 0, lastRun: { result: 'auth', at: 'x' } })] })
  assert.deepEqual(codes(old), [], '어제 낫고 지나간 일을 계속 외치면 안 된다')
})

test('재시작이 꺼져 있으면 인증 경보를 내지 않는다', () => {
  const d = base({ sessions: [sess({ on: false, authToday: 3, lastRun: { result: 'auth', at: 'x' } })] })
  assert.deepEqual(codes(d), [])
})

/* ── CLI 낡음 — 네 번째 «우리 잘못이 아닌 실패» ─────────────── */

/**
 * 🔴 실측 결함 (2026-09-30). 재개가 7초에 튕겼다:
 *     `API Error: 400 Claude Code 2.1.246 does not support this model;
 *      version 2.1.280 or newer is required. Run 'claude update' …`
 *   400 은 `isTransientFailure` 가 영구 오류로 배제하므로(그게 맞다) `fail` 이 되고
 *   세 번이면 회로가 차단된다. 그런데 **재시도로 낫지 않고 우리 잘못도 아니다** —
 *   기계에 설치본이 둘 있었고 우리만 낡은 것을 불렀다. 제한·과부하·인증에서 세 번 고친
 *   그 실패 방식의 네 번째 얼굴이다.
 */
const OUTDATED = "API Error: 400 Claude Code 2.1.246 does not support this model; "
  + "version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again."

test('🔴 CLI 낡음을 fail 로 세지 않는다 (차단하면 고칠 때까지 아무 말도 없다)', () => {
  assert.equal(classifyRun({ failed: true, label: OUTDATED }), 'outdated')
  assert.equal(isOutdatedFailure(OUTDATED), true)
})

test('문구에서 우리 버전과 필요한 버전을 뽑는다 (경보가 숫자를 그대로 보여준다)', () => {
  assert.deepEqual(outdatedVersions(OUTDATED), { ours: '2.1.246', needed: '2.1.280' })
  assert.deepEqual(outdatedVersions('아무 말'), { ours: null, needed: null })
})

test('🔴 인증 문구가 섞여 와도 CLI 낡음이 이긴다 (고칠 것은 버전이다)', () => {
  const both = OUTDATED + ' Failed to authenticate: please login again.'
  assert.equal(classifyRun({ failed: true, label: both }), 'outdated')
})

test('비슷해 보이는 다른 400 은 여전히 fail 이다 (모르는 것을 봐주지 않는다)', () => {
  const schema = 'API Error: 400 tools.11.custom.input_schema.properties: invalid'
  assert.equal(isOutdatedFailure(schema), false)
  assert.equal(classifyRun({ failed: true, label: schema }), 'fail')
})

test('🔴 차단기를 태우지 않고, 대신 센다', () => {
  const s = { ...emptyState(), failStreak: 2 }
  const n = recordRun(s, { result: 'outdated', tookSec: 7 }, { failStreakMax: 3 })
  assert.equal(n.failStreak, 2, '올리지도 않고 0 으로 되돌리지도 않는다')
  assert.equal(n.blocked, null)
  assert.equal(n.outdatedByDay[dayKey()], 1, '차단하지 않는 대신 세어야 한다')
})

test('🔴 한 번만 있어도 **치명** 경보다 (고치기 전까지 재개가 한 번도 못 돈다)', () => {
  const d = base({ sessions: [sess({ on: true, outdatedToday: 1 })], cli: { version: '2.1.246 (Claude Code)' } })
  const hit = currentAlerts(d).find((a) => a.code === 'CLI낡음')
  assert.ok(hit, '이것을 말하지 않으면 사람은 하루를 통째로 잃는다')
  assert.equal(hit.level, 'critical')
  assert.match(hit.desc, /2\.1\.246/, '우리가 띄우는 버전을 적어야 한다')
  assert.match(hit.desc, /claude update/, '고치는 방법을 적어야 한다')
  assert.match(hit.desc, /한 번도 돌지 않습니다/, '무엇을 잃고 있는지 적어야 한다')
})

/**
 * 🔴 **회차를 태우기 전에** 말한다 (실측 2026-09-30). 어긋남은 띄우기 전에 알 수 있다 —
 *   그 세션의 트랜스크립트에 «마지막으로 쓴 CLI 버전» 이 적혀 있다. 우리 것이 더 낡으면
 *   그 세션의 모델을 모를 수 있고 회차는 7초에 튕긴다(대조군으로 확인: 2.1.246 은 거부,
 *   2.1.283 은 답했다 — 모델 `claude-opus-5-5`).
 */
test('🔴 우리 CLI 가 그 세션보다 낡으면 미리 경고한다', () => {
  const d = base({
    sessions: [{ ...sess({ on: true }), cliVer: '2.1.283' }],
    cli: { version: '2.1.246 (Claude Code)' },
  })
  const hit = currentAlerts(d).find((a) => a.code === 'CLI어긋남')
  assert.ok(hit, '띄우고 나서 후회하는 것보다 미리 말하는 편이 싸다')
  assert.match(hit.desc, /2\.1\.283/)
  assert.match(hit.desc, /2\.1\.246/)
  assert.equal(hit.level, 'warning', '아직 튕기지는 않았다 — 치명은 실제로 튕겼을 때다')
})

test('같거나 우리가 더 새것이면 말하지 않는다 (늑대를 외치면 진짜 늑대를 놓친다)', () => {
  const same = base({ sessions: [{ ...sess({ on: true }), cliVer: '2.1.283' }], cli: { version: '2.1.283 (Claude Code)' } })
  assert.equal(codes(same).includes('CLI어긋남'), false)
  const newer = base({ sessions: [{ ...sess({ on: true }), cliVer: '2.1.246' }], cli: { version: '2.1.283 (Claude Code)' } })
  assert.equal(codes(newer).includes('CLI어긋남'), false)
})

test('버전을 모르면 말하지 않는다 (모르는 것으로 사람을 부르지 않는다)', () => {
  const d = base({ sessions: [{ ...sess({ on: true }), cliVer: null }], cli: { version: '2.1.246 (Claude Code)' } })
  assert.equal(codes(d).includes('CLI어긋남'), false)
})
