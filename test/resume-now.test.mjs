/**
 * resume-now.test.mjs — **`--now`(화면의 `지금 재시작 실행`) 가 무엇을 건너뛰고 무엇은 못 건너뛰나.**
 *
 * 🔴 사용자 결정 (2026-09-28): «지금 재시작 실행은 사용자의 의지로 실행하는 것이기 때문에
 *   재시작 조건과 상관없이 강제로 재개지시를 실행한다.»
 *
 *   그래서 `--force` 보다 세다. force 는 «기다리면 풀리는 것»만 건너뛰고 일하는 세션·제한
 *   중·모르는 상태는 지켰다(`resume-force.test.mjs` 의 표). `--now` 는 그 셋도 건너뛴다.
 *
 * 🔴 왜 시험이 필요한가 — 이 계약은 **두 번 뒤집혔다.** 처음에는 아껴 쓰기만 건너뛰었고,
 *   그다음 전부로 넓혔다. 표가 없으면 다음 사람이 "일하는 세션은 지켜야 한다"는 (그 자체로
 *   옳은) 이유로 관문을 되살리고, 사용자는 단추를 눌렀는데 아무 일도 안 나는 화면을 본다.
 *   반대로 **없으면 띄울 수가 없는 둘**(띄울 자리·보낼 말)이 사라지면 돈만 쓰고 끝난다 —
 *   실측으로 $18.27 을 쓰고 디스크 변경 0건으로 끝난 회차가 그 부류였다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nowGate, GATE } from '../src/lib/resume-gate.mjs'

const project = (over = {}) => ({
  id: 'P', repo: 'c:\\r',
  resume: { enabled: true, maxPerDay: 12, minGapMin: 30, failStreakMax: 3, sessionActiveMin: 3, timeoutMin: 30, quietHours: null, ...over },
})
const base = (over = {}) => ({
  target: { restart: true, resumePrompt: '이어라' },
  project: project(),
  session: { activeMin: 60, openTools: 0, lastKind: 'assistant', stoppedByLimit: false, stoppedByInterrupt: false, quota: null },
  tracker: { exists: false },
  ...over,
})

/**
 * 🔴 **평소 판정(`resumeGate`)이 막는 모든 자리를 `--now` 는 뚫는다.**
 *   force 로도 못 뚫던 것(제한 중·일하는 중·모름·저장소 잠금)까지 포함한다.
 */
const bypass = [
  ['스위치 꺼짐', { target: { restart: false, resumePrompt: '이어라' } }],
  ['조용한 시간', { project: project({ quietHours: { from: '00:00', to: '23:59' } }) }],
  ['방금 활동', { session: { ...base().session, activeMin: 0 } }],
  ['저장소 잠금', { project: project({ enabled: false }) }],
  ['집계 없음', { session: null }],
  ['활동시각 모름', { session: { ...base().session, activeMin: null } }],
  ['도구 대기', { session: { ...base().session, openTools: 3, activeMin: 1 } }],
  ['차례가 사람', { session: { ...base().session, lastKind: 'user', activeMin: 1 } }],
  ['제한 중', { session: { ...base().session, quota: { resetsAt: Math.floor(Date.now() / 1000) + 3600 } } }],
  ['추적기 할일없음', { tracker: { exists: true, allDone: true, doneMark: '9/9' } }],
  ['추적기 손상', { tracker: { exists: true, error: '깨졌다' } }],
]

for (const [name, over] of bypass) {
  test(`🔴 --now 계약 — ${name}: 건너뛰고 띄운다`, () => {
    const v = nowGate(base(over))
    assert.equal(v.go, true, `${name}: 사람이 누른 것을 막으면 안 된다 (${v.stage} · ${v.why})`)
    assert.equal(v.stage, null)
    assert.match(v.why, /사람이 지금 띄웠다/, '왜 조건을 건너뛴 것인지 로그에 남아야 한다')
  })
}

/**
 * 🔴 **이 둘은 «조건»이 아니다** — 없으면 띄울 수가 없다. 건너뛰면 돈만 쓰고 끝난다.
 */
test('🔴 --now 도 띄울 자리가 없으면 띄우지 않는다 (작업 디렉터리)', () => {
  const v = nowGate(base({ project: null }))
  assert.equal(v.go, false)
  assert.equal(v.stage, GATE.repo)
  assert.match(v.why, /자리가 없다/)
})

test('🔴 --now 도 보낼 말이 없으면 띄우지 않는다 (재개지시·추적기·잘린 자리 전부 없음)', () => {
  const v = nowGate(base({ target: { restart: true } }))
  assert.equal(v.go, false)
  assert.equal(v.stage, GATE.point)
  assert.match(v.why, /설정 탭에 재개지시를 넣어라/, '무엇을 하면 되는지 말해야 한다')
})

test('추적기가 손상됐어도 잘린 자리가 있으면 그것으로 띄운다', () => {
  const v = nowGate(base({
    target: { restart: true },
    tracker: { exists: true, error: '깨졌다' },
    session: { ...base().session, stoppedByLimit: true },
  }))
  assert.equal(v.go, true)
  assert.equal(v.point, '제한으로 잘린 지점')
})

/**
 * 🔴 **이름이 실제로 보내는 것과 같아야 한다.** `buildPrompt`(lib/prompt.mjs) 는
 *   `target.resumePrompt` 가 있으면 추적기를 보지 않고 그것을 보낸다. 여기서 순서를
 *   달리 적으면 로그가 `doing 07` 이라 말하고 실제로는 재개지시를 보낸다 — 거짓 기록이다.
 */
const points = [
  ['재개지시가 있으면 그것 (추적기보다 먼저 — 실제로 보내지는 것이 그것이다)',
    { target: { restart: true, resumePrompt: '이어라' }, tracker: { exists: true, doing: { id: '07' } } }, '재개지시'],
  ['재개지시가 없으면 추적기 doing',
    { target: { restart: true }, tracker: { exists: true, doing: { id: '07' } } }, 'doing 07'],
  ['doing 이 없으면 todo',
    { target: { restart: true }, tracker: { exists: true, nextTodo: { id: '08' } } }, 'todo 08'],
  ['추적기가 없으면 제한으로 잘린 자리',
    { target: { restart: true }, session: { ...base().session, stoppedByLimit: true } }, '제한으로 잘린 지점'],
  ['제한도 아니면 끊긴 자리',
    { target: { restart: true }, session: { ...base().session, stoppedByInterrupt: true } }, '끊긴 지점'],
]

for (const [name, over, want] of points) {
  test(`--now 재개 지점 — ${name}`, () => {
    const v = nowGate(base(over))
    assert.equal(v.go, true, v.why)
    assert.equal(v.point, want)
  })
}

test('🔴 끊긴 자리를 이미 이어 봤어도 --now 는 막지 않는다 (사람이 판단할 일이다)', () => {
  // 평소 판정은 GATE.repeated 로 막는다. 사람이 누른 것은 그 판단을 덮는다.
  const v = nowGate(base({
    target: { restart: true },
    session: { ...base().session, stoppedByInterrupt: true },
    state: { lastRun: { point: '끊긴 지점' } },
  }))
  assert.equal(v.go, true)
})

test('인자가 없어도 던지지 않는다 (판정이 던지면 그 회차가 이유 없이 죽는다)', () => {
  for (const arg of [undefined, null, {}]) {
    const v = nowGate(arg)
    assert.equal(v.go, false)
    assert.equal(v.stage, GATE.repo)
  }
})

/* ── 진입점이 그 판정을 정말 쓰는가 ──────────────────────────── */

test('🔴 resume.mjs 는 --now 판정을 직접 짜지 않고 nowGate 를 부른다', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../src/resume.mjs', import.meta.url)), 'utf8')
  assert.match(src, /nowGate\(\{[^}]*target[^}]*\}\)/, 'nowGate 를 불러야 한다')
  assert.match(src, /const NOW = flag\('--now'\)/, '--now 플래그를 읽어야 한다')
  // 예약 회차가 실수로 이 길로 오면 아껴 쓰기가 통째로 사라진다
  const code = src.split('\n').filter((l) => !l.trim().startsWith('*')).join('\n')
  assert.ok(!/NOW\s*=\s*true/.test(code), '--now 를 코드에서 켜 두면 예약 회차도 조건을 건너뛴다')
})
