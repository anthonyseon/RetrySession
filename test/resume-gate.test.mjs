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
import { readFileSync } from 'node:fs'
import { resumeGate, GATE } from '../src/lib/resume-gate.mjs'

const project = (over = {}) => ({
  id: 'P', repo: 'c:\\r',
  resume: { enabled: true, maxPerDay: 12, maxCostUSDPerDay: 5, failStreakMax: 3, sessionActiveMin: 10, quietHours: null, ...over },
})
const base = (over = {}) => ({
  target: { restart: true, resumePrompt: '이어서 해라' },
  project: project(),
  state: { byDay: {}, costByDay: {}, failStreak: 0, blocked: null },
  // 🔴 '쓰는 중'의 재료: 조용한 시간 · 미완결 도구 · 마지막 차례 (pid 는 넘기지 않는다)
  session: { activeMin: 60, openTools: 0, lastKind: 'assistant', stoppedByLimit: false, stoppedByInterrupt: false, quota: null },
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

/**
 * 🔴 막는 것은 "프로세스가 살아 있다"가 아니라 **"그 세션이 일하는 중이다"** 다.
 *
 *   창을 열어 둔 채 다른 세션에서 일하는 것이 보통인데, pid 로 막으면 그 세션은 영원히
 *   "사용 중"이다 — 실측 560회 연속 건너뜀(2026-09-22~09-28). 그래서 판정 재료를 pid 에서
 *   그 세션의 기록으로 옮겼다. 두 가지가 "일하는 중"이다:
 *     · 결과를 기다리는 도구가 있다        (긴 빌드가 도는 동안 파일은 조용하다)
 *     · 마지막 차례가 사람이다             (답이 아직 안 나왔다 — 도구 없이 오래 생각하는 답)
 */
test('🔴 도구가 결과를 기다리는 중이면 막는다 — force 로도 못 뚫는다', () => {
  for (const force of [false, true]) {
    // 조용한 시간이 타임아웃보다 짧아야 '도는 중'이다 (그보다 길면 낡은 것으로 본다)
    const g = resumeGate(base({ session: { ...base().session, openTools: 2, activeMin: 5 }, force }))
    assert.equal(g.go, false, `force=${force} 인데 통과했다`)
    assert.equal(g.stage, GATE.busy)
    assert.match(g.why, /도구 2개/)
  }
})

test('🔴 마지막 차례가 사람이면 막는다 (답이 아직 안 나왔다) — force 로도 못 뚫는다', () => {
  for (const force of [false, true]) {
    const g = resumeGate(base({ session: { ...base().session, lastKind: 'user', activeMin: 5 }, force }))
    assert.equal(g.go, false, `force=${force} 인데 통과했다`)
    assert.equal(g.stage, GATE.busy)
    assert.match(g.why, /마지막 차례가 사람/)
  }
})

test('🔴 답을 마치고 사람을 기다리는 세션은 통과한다 (창이 열려 있어도)', () => {
  // 이것이 사용자가 말한 그 경우다 — 다른 세션에서 일하는 동안 이 세션은 멈춰 서 있다
  const g = resumeGate(base())
  assert.equal(g.go, true, `멈춰 선 세션을 막으면 이 도구는 아무 일도 하지 않는다: ${g.why}`)
})

test('🔴 일하는 중 판정에도 끝이 있다 (도구 도중에 죽은 세션이 영구히 막으면 안 된다)', () => {
  // 한 회차 타임아웃(30분)보다 오래 조용하면 그 도구는 끝났거나 세션이 죽은 것이다
  const dead = { ...base().session, openTools: 3, lastKind: 'user', activeMin: 200 }
  const g = resumeGate(base({ session: dead }))
  assert.equal(g.go, true, `끝 없는 차단은 fail-open 만큼 나쁘다: ${g.stage} · ${g.why}`)
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
  const g = resumeGate(base({ session: parked(), target: { restart: true } }))
  assert.equal(g.go, true, `539번 건너뛴 그 상황이다: ${g.why}`)
  assert.equal(g.point, '제한으로 잘린 지점')
  assert.match(g.why, /사람을 기다리는 상태/, '로그가 사실을 말해야 한다')
})

test('🔴 제한이 아직 안 풀렸으면 막는다 (예외는 해제 뒤에만이다)', () => {
  const g = resumeGate(base({ session: parked({ quota: stillLimited }) }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.limited, `실행 중보다 제한을 먼저 말해야 한다: ${g.stage}`)
})

test('🔴 일하는 중이면 재개 지점이 무엇이든 막는다 (지점이 관문을 열지 않는다)', () => {
  // 제한 잘림·끊김·재개지시·추적기 — 어느 지점이든 "일하는 중"을 이기지 못한다
  const working = { openTools: 1, lastKind: 'assistant', activeMin: 5 }
  const cases = {
    제한잘림: { session: parked({ ...working }) },
    끊김: { session: parked({ ...working, stoppedByLimit: false, stoppedByInterrupt: true }) },
    재개지시: { session: parked({ ...working, stoppedByLimit: false }), target: { restart: true, resumePrompt: '이어라' } },
    추적기: { session: parked({ ...working, stoppedByLimit: false }), tracker: { exists: true, doing: { id: 'W1' }, doneMark: '1/2' } },
  }
  for (const [name, over] of Object.entries(cases)) {
    const g = resumeGate(base({ ...over }))
    assert.equal(g.go, false, `${name}: 일하는 세션에 들어갔다`)
    assert.equal(g.stage, GATE.busy, `${name}: ${g.stage}`)
  }
})

test('🔴 제한 알림 직후(사람이 아직 붙어 있을 수 있다)에는 기다린다', () => {
  const g = resumeGate(base({ session: parked({ activeMin: 3 }) }))
  assert.equal(g.go, false, '제한 알림 뒤 3분은 조용한 것이 아니다')
  assert.equal(g.stage, GATE.active)
})

test('🔴 잘린 자리는 추적기의 "할 일 없음"보다 우선한다 (실측: 9/9 done 으로 건너뛰었다)', () => {
  const tracker = { exists: true, allDone: true, doneMark: '9/9', doing: null, nextTodo: null }
  const g = resumeGate(base({ session: parked(), tracker, target: { restart: true } }))
  assert.equal(g.go, true, '추적기가 다 done 이라고 끊긴 일이 끊기지 않은 게 되지 않는다')
  assert.equal(g.point, '제한으로 잘린 지점')
})

test('추적기에 할 일이 있으면 그것을 지점으로 쓴다 (가장 구체적이다)', () => {
  const tracker = { exists: true, allDone: false, doneMark: '3/9', doing: { id: 'W3-2' }, nextTodo: null }
  const g = resumeGate(base({ session: parked(), tracker }))
  assert.equal(g.go, true)
  assert.equal(g.point, 'doing W3-2')
})

test('잘린 자리가 없으면 추적기의 "할 일 없음"은 그대로 막는다', () => {
  const tracker = { exists: true, allDone: true, doneMark: '9/9', doing: null, nextTodo: null }
  // 🔴 사람의 지시가 없을 때다 — 재개지시가 있으면 그것이 낡은 장부를 넘어선다(아래 시험)
  const g = resumeGate(base({ target: { restart: true }, session: { ...base().session, stoppedByLimit: false }, tracker }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.tracker)
  assert.match(g.why, /할 일이 없다/)
})

/**
 * 🔴 **모르면 막는다** — pid 대신 기록으로 판정하게 됐어도 이 원칙은 그대로다.
 *   조용한 시간을 모르면 "그 세션을 쓰고 있나"에 답할 수 없다. 모르는 것을 "괜찮다"로
 *   읽는 것이 이 저장소가 가장 여러 번 다친 방식이다(목록이 비었으니 아무도 안 돈다 ·
 *   atEpoch 가 없으니 살아있다 · 조회가 실패했으니 0개).
 */
test('🔴 조용한지 모르면 막는다 — force 로도 못 뚫는다 (fail-closed)', () => {
  for (const quiet of [null, undefined, NaN]) {
    for (const force of [false, true]) {
      const g = resumeGate(base({ session: { ...base().session, activeMin: quiet }, force }))
      assert.equal(g.go, false, `activeMin=${quiet} · force=${force} 인데 통과했다`)
      assert.equal(g.stage, GATE.unknown)
    }
  }
})

/**
 * 🔴 판정의 **재료가 응답에 실려야** 한다.
 *
 *   실측 (2026-09-28): 판정은 `openTools`·`lastKind` 로 `작업중` 을 정확히 말하는데
 *   화면으로 나가는 세션 객체에는 그 두 값이 없었다(`undefined`). 근거를 볼 수 없으면
 *   "왜 작업중인가"를 확인하려고 트랜스크립트를 다시 읽어야 한다 —
 *   값만 있고 근거가 없으면 판단할 수 없다(요약 타일에서 이미 고친 부류다).
 */
test('🔴 판정 재료가 화면으로 나가는 세션 객체에 있다', () => {
  const src = readFileSync(new URL('../src/lib/session-view.mjs', import.meta.url), 'utf8')
  // 판정에 넘기는 것과 화면에 내보내는 것, 두 자리 모두 있어야 한다
  assert.ok((src.match(/openTools/g) || []).length >= 2, 'openTools 를 판정에만 넘기고 화면에는 안 준다')
  assert.ok((src.match(/lastKind/g) || []).length >= 2, 'lastKind 를 판정에만 넘기고 화면에는 안 준다')
})

/**
 * 🔴 판정은 **던지지 않는다.** 던지면 그 회차가 통째로 죽고, 죽은 회차는 이유를 남기지
 *   못한다 — 조용히 아무 일도 일어나지 않는 상태가 되는데 그게 이 도구의 최악이다.
 *   (실측 2026-09-28: 인자 없이 부르면 구조분해에서 던졌다. 호출부는 전부 객체를 넘기지만
 *   "지금은 안 그런다"는 이유로 두면 다음 호출부가 그 지뢰를 밟는다.)
 */
test('🔴 인자가 없어도 던지지 않고 "안 된다"로 답한다', () => {
  for (const arg of [undefined, {}, null]) {
    const g = resumeGate(arg)
    assert.equal(g.go, false, `${arg} 로 불렀는데 통과했다`)
    assert.ok(g.why, '이유 없이 막으면 사람이 무엇을 볼지 알 수 없다')
  }
})

test('세션 집계 자체가 없으면 막는다 (트랜스크립트가 정리된 것이다)', () => {
  const g = resumeGate(base({ session: null, force: true }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.gone)
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
  const g = resumeGate(base({ target: { restart: true }, tracker: { exists: true, allDone: true, doneMark: '9/9' } }))
  assert.equal(g.go, false)
  assert.equal(g.stage, GATE.tracker)
  assert.match(g.why, /9\/9/)
})

/**
 * 🔴 **사람이 적은 재개지시는 낡은 추적기를 넘어선다.**
 *
 *   실측 (2026-09-28): 추적기가 9월 22일에 끝난 프로그램의 것이라 `9/9 전부 done` 인데
 *   그 세션에는 실제로 남은 일이 많았다(상태 정본이 JSON 에서 계획서 본문으로 옮겨갔다).
 *   화면은 "설정 탭에서 재개지시를 넣어라"라고 안내하는데, 예전에는 **그렇게 해도 막혔다** —
 *   안내대로 해도 안 되는 화면은 고장난 화면과 같다.
 *   계획표는 기계의 장부이고 재개지시는 사람이 직접 내린 지시다.
 */
test('🔴 추적기가 전부 done 이어도 재개지시가 있으면 이어받는다', () => {
  const tracker = { exists: true, allDone: true, doneMark: '9/9', doing: null, nextTodo: null }
  const g = resumeGate(base({ tracker, session: { ...base().session, stoppedByLimit: false } }))
  assert.equal(g.go, true, `사람이 적은 지시가 낡은 장부에 막히면 안 된다: ${g.why}`)
  assert.equal(g.point, '재개지시', '지점은 사람의 지시다')
})

test('추적기에 할 일이 있으면 재개지시보다 그쪽이 구체적이다', () => {
  const tracker = { exists: true, allDone: false, doneMark: '3/9', doing: { id: 'W3-2' }, nextTodo: null }
  assert.equal(resumeGate(base({ tracker })).point, 'doing W3-2')
})

test('추적기를 못 읽으면 막는다 (모르면 안 민다)', () => {
  assert.equal(resumeGate(base({ target: { restart: true }, tracker: { exists: true, error: '깨졌다' } })).stage, GATE.tracker)
})

/* ── 모를 때 ─────────────────────────────────────────────────── */

test('값이 없어도 터지지 않고 "안 된다"로 답한다', () => {
  for (const input of [{}, { target: null }, { target: {}, project: null }]) {
    const g = resumeGate(input)
    assert.equal(g.go, false, `${JSON.stringify(input)} 에서 통과하면 안 된다`)
    assert.ok(g.why, '이유를 말해야 한다')
  }
})
