/**
 * resume-gate.test.mjs — "지금 재개해도 되나" 판정. **순수 함수라 진짜로 불러 본다.**
 *
 * 🔴 왜 소스 정규식에서 여기로 옮겼나
 *   예전에는 `resume.mjs` 의 소스에 `if (limitInfo.limited) return stop(...)` 이 있는지를
 *   정규식으로 봤다. 그건 "코드가 저렇게 생겼나"를 확인할 뿐 **그래서 무엇을 답하는지**는
 *   확인하지 못한다. 판정을 lib/resume-gate.mjs 로 떼어내면서 불러 볼 수 있게 됐다.
 *
 * 🔴 이 판정은 화면도 같은 함수로 쓴다. 예전에는 화면이 **예산만** 보고 "재시작 준비"라고
 *   말했는데 실제로는 여덟 가지가 더 막았다 — 그래서 "켰는데 왜 안 도나"가 반복됐다.
 *   여기서 막는 것은 전부 화면에도 같은 말로 나와야 한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumeGate, GATE } from '../src/lib/resume-gate.mjs'

const project = (over = {}) => ({
  id: 'P', repo: 'c:\\r',
  resume: { enabled: true, maxPerDay: 12, maxCostUSDPerDay: 5, failStreakMax: 3, sessionActiveMin: 10, quietHours: null, ...over },
})
const notRunning = { running: false, isCertain: true, why: null }
const base = (over = {}) => ({
  target: { restart: true, resumePrompt: '이어서 해라' },
  project: project(),
  state: { byDay: {}, costByDay: {}, failStreak: 0, blocked: null },
  session: { activeMin: 60, stoppedByLimit: false, stoppedByInterrupt: false, quota: null },
  running: notRunning,
  tracker: { exists: false },
  ...over,
})

test('전부 통과하면 재개 지점을 알려준다', () => {
  const g = resumeGate(base())
  assert.equal(g.go, true)
  assert.equal(g.point, '재개지시')
  assert.equal(g.stage, null)
})

/* ── force 로 뚫리면 안 되는 것들 ────────────────────────────── */

test('🔴 실행 중이면 막는다 — force 로도 못 뚫는다', () => {
  const running = { running: true, isCertain: true, why: '세션이 실행 중이다 (pid 7)' }
  for (const force of [false, true]) {
    const g = resumeGate(base({ running, force }))
    assert.equal(g.go, false, `force=${force} 인데 통과했다`)
    assert.equal(g.stage, GATE.running)
    assert.match(g.why, /실행 중/)
  }
})

/* ── 제한이 풀린 순간, 살아 있지만 멈춰 선 세션 ─────────────── */

/**
 * 🔴 이 도구를 만든 목적이 정확히 이 경우다. 실측 (2026-09-28):
 *     `SKIP ×539 (처음 2026-09-22 16:18:15) · 세션이 실행 중이다 (pid 4084)`
 *   같은 시각의 사실: 제한 잘림 O · 제한 해제 9분 전 · 마지막 활동 38.7분 전.
 *   제한에 걸리면 CLI 는 **살아서 멈춰 선다** → pid 가 잡힌다 → "사람이 쓰는 중"으로
 *   읽혀 영원히 건너뛴다. 제한이 풀리는 순간이 오히려 확실히 막히는 구조였다.
 *
 *   예외의 안전 근거는 pid 가 아니라 **트랜스크립트**다: `stoppedByLimit` 은 "마지막
 *   엔트리가 제한 알림"이라는 뜻이고, 사람이 한 글자라도 넣으면 즉시 꺼진다.
 */
const lifted = { resetsAt: Math.floor(Date.now() / 1000) - 600 }   // 10분 전에 풀렸다
const stillLimited = { resetsAt: Math.floor(Date.now() / 1000) + 600 }
const runningNow = { running: true, isCertain: true, why: '세션이 실행 중이다 (pid 4084)' }
const parked = (over = {}) => ({ activeMin: 38.7, stoppedByLimit: true, stoppedByInterrupt: false, quota: lifted, ...over })

test('🔴 제한에 잘린 채 멈춰 있고 제한이 풀렸으면 — 실행 중이어도 이어받는다', () => {
  const g = resumeGate(base({ running: runningNow, session: parked(), target: { restart: true } }))
  assert.equal(g.go, true, `539번 건너뛴 그 상황이다: ${g.why}`)
  assert.equal(g.point, '제한으로 잘린 지점')
  assert.match(g.why, /프로세스는 살아 있지만/, '로그가 사실을 말해야 한다')
})

test('🔴 제한이 아직 안 풀렸으면 막는다 (예외는 해제 뒤에만이다)', () => {
  const g = resumeGate(base({ running: runningNow, session: parked({ quota: stillLimited }) }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.limited, `실행 중보다 제한을 먼저 말해야 한다: ${g.stage}`)
})

test('🔴 제한 잘림이 아닌 이유로는 살아 있는 세션에 들어가지 않는다', () => {
  // 끊김·재개지시·추적기만으로는 여전히 running 에서 멈춘다 — 예외가 새면 안 된다
  const cases = {
    끊김: { session: parked({ stoppedByLimit: false, stoppedByInterrupt: true }) },
    재개지시: { session: parked({ stoppedByLimit: false }), target: { restart: true, resumePrompt: '이어라' } },
    추적기: { session: parked({ stoppedByLimit: false }), tracker: { exists: true, doing: { id: 'W1' }, doneMark: '1/2' } },
  }
  for (const [name, over] of Object.entries(cases)) {
    const g = resumeGate(base({ running: runningNow, ...over }))
    assert.equal(g.go, false, `${name}: 살아 있는 세션에 들어갔다`)
    assert.equal(g.stage, GATE.running, `${name}: ${g.stage}`)
  }
})

test('🔴 제한 알림 직후(사람이 아직 붙어 있을 수 있다)에는 기다린다', () => {
  const g = resumeGate(base({ running: runningNow, session: parked({ activeMin: 3 }) }))
  assert.equal(g.go, false, '제한 알림 뒤 3분은 조용한 것이 아니다')
  assert.equal(g.stage, GATE.active)
})

test('🔴 잘린 자리는 추적기의 "할 일 없음"보다 우선한다 (실측: 9/9 done 으로 건너뛰었다)', () => {
  const tracker = { exists: true, allDone: true, doneMark: '9/9', doing: null, nextTodo: null }
  const g = resumeGate(base({ running: runningNow, session: parked(), tracker, target: { restart: true } }))
  assert.equal(g.go, true, '추적기가 다 done 이라고 끊긴 일이 끊기지 않은 게 되지 않는다')
  assert.equal(g.point, '제한으로 잘린 지점')
})

test('추적기에 할 일이 있으면 그것을 지점으로 쓴다 (가장 구체적이다)', () => {
  const tracker = { exists: true, allDone: false, doneMark: '3/9', doing: { id: 'W3-2' }, nextTodo: null }
  const g = resumeGate(base({ running: runningNow, session: parked(), tracker }))
  assert.equal(g.go, true)
  assert.equal(g.point, 'doing W3-2')
})

test('잘린 자리가 없으면 추적기의 "할 일 없음"은 그대로 막는다', () => {
  const tracker = { exists: true, allDone: true, doneMark: '9/9', doing: null, nextTodo: null }
  const g = resumeGate(base({ session: { ...base().session, stoppedByLimit: false }, tracker }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.tracker)
  assert.match(g.why, /할 일이 없다/)
})

test('🔴 실행 여부를 **모르면** 막는다 (fail-closed)', () => {
  const unknown = { running: true, isCertain: false, why: '실행 중 여부를 확인할 수 없다' }
  assert.equal(resumeGate(base({ running: unknown, force: true })).go, false)
})

test('🔴 사용량 제한 중이면 막는다 — force 로도 못 뚫는다 (제한이 차단기를 태운다)', () => {
  // resetsAt 은 **초** 단위다 (guard.limitState 참조)
  const quota = { resetsAt: Math.floor(Date.now() / 1000) + 3600, rateLimitType: 'session' }
  for (const force of [false, true]) {
    const g = resumeGate(base({ session: { ...base().session, quota }, force }))
    assert.equal(g.go, false, `force=${force} 인데 통과했다`)
    assert.equal(g.stage, GATE.limited)
  }
})

test('🔴 저장소가 자율 재개를 껐으면 막는다 — force 로도 못 뚫는다', () => {
  for (const force of [false, true]) {
    const g = resumeGate(base({ project: project({ enabled: false }), force }))
    assert.equal(g.go, false, `force=${force} 인데 통과했다`)
    assert.equal(g.stage, GATE.repo)
    assert.match(g.why, /resume\.enabled/, '어디를 고치면 되는지 말해야 한다')
  }
})

test('작업 디렉터리를 모르면 막는다', () => {
  const g = resumeGate(base({ project: null, force: true }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.repo)
})

test('세션을 못 찾으면 막는다', () => {
  assert.equal(resumeGate(base({ session: null, force: true })).stage, GATE.gone)
})

/* ── force 로 건너뛰는 것들 ──────────────────────────────────── */

test('재시작이 꺼져 있으면 막는다 (force 는 이것을 건너뛴다)', () => {
  assert.equal(resumeGate(base({ target: { restart: false, resumePrompt: 'x' } })).stage, GATE.off)
  assert.equal(resumeGate(base({ target: { restart: false, resumePrompt: 'x' }, force: true })).go, true)
})

test('방금까지 활동이 있었으면 막는다 (force 는 건너뛴다)', () => {
  const session = { ...base().session, activeMin: 2 }
  assert.equal(resumeGate(base({ session })).stage, GATE.active)
  assert.equal(resumeGate(base({ session, force: true })).go, true)
})

test('하루 상한을 넘겼으면 막는다 (force 는 건너뛴다)', () => {
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const state = { byDay: { [key]: 99 }, costByDay: {}, failStreak: 0, blocked: null }
  assert.equal(resumeGate(base({ state })).stage, GATE.budget)
  assert.equal(resumeGate(base({ state, force: true })).go, true)
})

test('회로가 차단됐으면 그 단계 이름으로 말한다 (예산과 구별된다)', () => {
  const state = { byDay: {}, costByDay: {}, failStreak: 3, blocked: { at: 'x', reason: '연속 3회 실패' } }
  assert.equal(resumeGate(base({ state })).stage, GATE.blocked)
})

/* ── 재개 지점 넷 ────────────────────────────────────────────── */

test('🔴 추적기도 재개지시도 없으면 막는다 — 무엇을 이어서 할지 모르는 채로 띄우지 않는다', () => {
  const g = resumeGate(base({ target: { restart: true, resumePrompt: null } }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.point)
  assert.match(g.why, /재개지시/, '무엇을 하면 되는지 말해야 한다')
})

test('🔴 제한에 잘린 자리는 추적기·재개지시가 없어도 재개 지점이다', () => {
  const g = resumeGate(base({
    target: { restart: true, resumePrompt: null },
    session: { ...base().session, stoppedByLimit: true },
  }))
  assert.equal(g.go, true)
  assert.equal(g.point, '제한으로 잘린 지점')
  assert.match(g.why, /제한/)
})

test('🔴 끊긴 자리도 재개 지점이다 (절전·연결 끊김)', () => {
  const g = resumeGate(base({
    target: { restart: true, resumePrompt: null },
    session: { ...base().session, stoppedByInterrupt: true },
  }))
  assert.equal(g.go, true)
  assert.equal(g.point, '끊긴 지점')
})

test('🔴 끊긴 자리는 **한 번만** 이어 본다 — 또 끊겼으면 원인이 절전이 아니다', () => {
  const g = resumeGate(base({
    target: { restart: true, resumePrompt: null },
    session: { ...base().session, stoppedByInterrupt: true },
    state: { ...base().state, lastRun: { point: '끊긴 지점' } },
    force: true,
  }))
  assert.equal(g.go, false, 'force 로도 뚫으면 같은 곳에서 또 깨진다')
  assert.equal(g.stage, GATE.repeated)
})

test('추적기가 있으면 그쪽이 재개 지점이다', () => {
  const g = resumeGate(base({ tracker: { exists: true, doing: { id: 'W3-2' }, nextTodo: null, allDone: false } }))
  assert.equal(g.point, 'doing W3-2')
})

test('🔴 추적기가 전부 done 이면 막는다 — 할 일 없이 일을 만들지 않는다', () => {
  const g = resumeGate(base({ tracker: { exists: true, allDone: true, doneMark: '9/9' } }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.tracker)
  assert.match(g.why, /9\/9/)
})

test('추적기를 못 읽으면 막는다 (모르면 안 민다)', () => {
  assert.equal(resumeGate(base({ tracker: { exists: true, error: '깨졌다' } })).stage, GATE.tracker)
})

/* ── 모를 때 ─────────────────────────────────────────────────── */

test('값이 없어도 터지지 않고 "안 된다"로 답한다', () => {
  for (const input of [{}, { target: null }, { target: {}, project: null }]) {
    const g = resumeGate(input)
    assert.equal(g.go, false, `${JSON.stringify(input)} 에서 통과하면 안 된다`)
    assert.ok(g.why, '이유를 말해야 한다')
  }
})
