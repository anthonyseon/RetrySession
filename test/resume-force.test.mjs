/**
 * resume-force.test.mjs — **`--force` 가 무엇을 뚫고 무엇을 못 뚫는가.**
 *
 * 🔴 왜 표를 시험으로 두나 — 관문 하나를 `if (!force)` 블록 **안으로 옮기는 것만으로**
 *   성질이 바뀐다. 코드를 읽어서는 어느 관문이 어느 쪽인지 금방 헷갈리고, 바뀐 것을
 *   알아채는 방법은 표뿐이다. 그래서 열일곱 상황을 단계별로 못박는다.
 *
 * 🔴 force 의 계약: **기다리면 풀리는 것만 건너뛴다.** 틀렸을 때 사람을 다치게 하는 것
 *   (일하는 세션에 끼어들기 · 모르는 상태로 밀기 · 저장소 잠금 무시)은 건너뛰지 않는다.
 *   그리고 force 는 **판정만** 건드린다 — 락·단일 실행·실행 직전 재판정·권한은 무관하다.
 *
 * 실측 (2026-09-28, 전수 재검증): 이 표는 열일곱 상황을 force 유무로 돌려 얻었다.
 *   resume-gate.test.mjs 가 400줄을 넘어 이 파일로 갈랐다 — force 계약은 한 관심사다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumeGate, GATE } from '../src/lib/resume-gate.mjs'

const project = (over = {}) => ({
  id: 'P', repo: 'c:\r',
  resume: { enabled: true, maxPerDay: 12, minGapMin: 30, failStreakMax: 3, sessionActiveMin: 3, timeoutMin: 30, quietHours: null, ...over },
})
const base = (over = {}) => ({
  target: { restart: true, resumePrompt: '이어라' },
  project: project(),
  state: { byDay: {}, costByDay: {}, failStreak: 0, blocked: null },
  session: { activeMin: 60, openTools: 0, lastKind: 'assistant', stoppedByLimit: false, stoppedByInterrupt: false, quota: null },
  tracker: { exists: false },
  ...over,
})
/**
 * 🔴 **`--force` 의 계약을 단계별로 못박는다.**
 *
 *   force 는 «기다리면 풀리는 것»만 건너뛴다. 어느 관문이 어느 쪽인지는 코드를 읽어서는
 *   금방 헷갈린다 — 관문 하나를 `if (!force)` 블록 안으로 옮기는 것만으로 성질이 바뀌고,
 *   그걸 알아채는 방법은 표뿐이다. 그래서 표를 시험으로 둔다.
 *
 *   실측 (2026-09-28, 전수 재검증): 열일곱 상황을 force 유무로 돌려 이 표를 얻었다.
 */
const forceTable = [
  // [상황, 평소 단계, force 로 뚫리나]
  ['스위치 꺼짐', GATE.off, true],
  ['조용한 시간', GATE.quiet, true],
  ['방금 활동', GATE.active, true],
  ['하루 횟수 상한', GATE.budget, true],
  ['최소 간격', GATE.budget, true],
  ['연속실패', GATE.budget, true],
  ['회로 차단', GATE.blocked, true],
  ['상태 손상', GATE.budget, true],
  ['저장소 잠금', GATE.repo, false],
  ['집계 없음', GATE.gone, false],
  ['활동시각 모름', GATE.unknown, false],
  ['도구 대기', GATE.busy, false],
  ['차례가 사람', GATE.busy, false],
  ['제한 중', GATE.limited, false],
  ['추적기 할일없음', GATE.tracker, false],
  ['지점 없음', GATE.point, false],
  ['끊긴 지점 재시도', GATE.repeated, false],
]
const forceInput = {
  '스위치 꺼짐': { target: { restart: false, resumePrompt: '이어라' } },
  '조용한 시간': { project: project({ quietHours: { from: '00:00', to: '23:59' } }) },
  '방금 활동': { session: { ...base().session, activeMin: 1 } },
  '하루 횟수 상한': { state: { ...base().state, byDay: { [today()]: 99 } } },
  '최소 간격': { state: { ...base().state, lastRun: { atEpoch: Date.now() - 60_000 } } },
  '연속실패': { state: { ...base().state, failStreak: 3 } },
  '회로 차단': { state: { ...base().state, blocked: { at: 'x', reason: '연속 3회' } } },
  '상태 손상': { state: { ...base().state, corrupt: '깨졌다' } },
  '저장소 잠금': { project: project({ enabled: false }) },
  '집계 없음': { session: null },
  '활동시각 모름': { session: { ...base().session, activeMin: null } },
  '도구 대기': { session: { ...base().session, openTools: 1, activeMin: 5 } },
  '차례가 사람': { session: { ...base().session, lastKind: 'user', activeMin: 5 } },
  '제한 중': { session: { ...base().session, quota: { resetsAt: Math.floor(Date.now() / 1000) + 600 } } },
  '추적기 할일없음': { target: { restart: true }, tracker: { exists: true, allDone: true, doneMark: '9/9' } },
  '지점 없음': { target: { restart: true } },
  '끊긴 지점 재시도': {
    target: { restart: true },
    session: { ...base().session, stoppedByInterrupt: true },
    state: { ...base().state, lastRun: { point: '끊긴 지점' } },
  },
}

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

for (const [name, stage, bypassable] of forceTable) {
  test(`🔴 force 계약 — ${name}: 평소 ${stage} · force 로 ${bypassable ? '뚫린다' : '못 뚫는다'}`, () => {
    const over = forceInput[name]
    const plain = resumeGate(base({ ...over }))
    assert.equal(plain.go, false, `${name}: 평소에는 막아야 한다`)
    assert.equal(plain.stage, stage, `${name}: 평소 단계가 ${plain.stage} 다`)
    const forced = resumeGate(base({ ...over, force: true }))
    assert.equal(forced.go, bypassable,
      bypassable
        ? `${name}: force 로 뚫려야 하는데 ${forced.stage} 에서 막혔다`
        : `${name}: force 로 뚫려서는 안 된다 — 사람이 쓰는 대화·모르는 상태를 건드린다`)
  })
}
