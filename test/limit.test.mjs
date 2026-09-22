/**
 * limit.test.mjs — 사용량 제한을 둘러싼 판정.
 *
 * 🔴 이 기능은 **사람이 보지 않는 동안 돈을 쓴다.** 규칙 하나하나에 시험을 붙인다.
 *
 * 사용자가 물은 것: "사용량 제한 해제 후, 감시 중인 세션을 재실행하는 것이 맞는가?"
 * 답한 원리:
 *   ① 제한 중에는 띄우지 않는다 (띄우면 실패로 기록돼 회로를 태운다)
 *   ② resetsAt 이 지난 뒤에만
 *   ③ 세션 프로세스가 꺼져 있을 때만 (기존 가드 그대로)
 *   ④ **제한에 잘려 멈춘** 세션만 — 놀고 있던 세션을 깨우지 않는다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { limitState, isLimitFailure, recordRun, budgetVerdict, emptyState } from '../src/lib/guard.mjs'
import { isLimitNotice, foldEntry, emptyTotals } from '../src/lib/sessions.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const minutes = 60_000
const base = new Date('2026-09-22T12:00:00').getTime()
const seconds = (ms) => Math.round(ms / 1000)

/* ── ①② 제한 중인가 ────────────────────────────────────────── */

test('🔴 해제 시각이 미래면 제한 중이다 — 재개를 막는다', () => {
  const v = limitState({ resetsAt: seconds(base + 90 * minutes), rateLimitType: 'seven_day' }, base)
  assert.equal(v.limited, true)
  assert.equal(v.leftMin, 90)
  assert.match(v.why, /90분 후 해제/)
  assert.match(v.why, /회로를 태운다/, '왜 막는지 적어야 다음 사람이 되돌리지 않는다')
})

test('🔴 해제 시각이 지났으면 제한이 아니다 — 이제 이어갈 수 있다', () => {
  const v = limitState({ resetsAt: seconds(base - 1 * minutes) }, base)
  assert.equal(v.limited, false)
  assert.equal(v.lifted, true)
})

test('경계 — 해제 시각 정각은 이미 풀린 것으로 본다', () => {
  assert.equal(limitState({ resetsAt: seconds(base) }, base).limited, false)
})

/**
 * 🔴 여기서는 "모르면 막는다"를 쓰지 않는다.
 *   할당량 기록은 마지막으로 걸렸을 때 남은 것이고 새로 걸리기 전까지 남아 있다.
 *   해제 시각을 모른다고 막으면 그 기록 때문에 재개가 **영원히** 멎는다.
 *   끝이 없는 차단은 fail-open 만큼 나쁘다. 놓친 경우는 실행 결과가 받아낸다.
 */
test('🔴 할당량 기록이 없거나 해제 시각을 모르면 막지 않는다 (끝없는 차단 금지)', () => {
  for (const q of [null, undefined, {}, { resetsAt: null }, { resetsAt: 'x' }, { resetsAt: NaN }]) {
    assert.equal(limitState(q, base).limited, false, `${JSON.stringify(q)} 로 영구 차단되면 안 된다`)
  }
})

/* ── 제한 실패를 고장으로 세지 않는다 ───────────────────────── */

test('🔴 제한 때문에 실패한 회차는 연속실패를 올리지 않는다', () => {
  const s = { ...emptyState(), failStreak: 2 }
  const n = recordRun(s, { result: '제한', tookSec: 3 }, { failStreakMax: 3 }, base)
  assert.equal(n.failStreak, 2, '3 이 되면 회로가 차단된다 — 기다리면 될 일에')
  assert.equal(n.blocked, null)
  assert.equal(budgetVerdict(n, { failStreakMax: 3 }, base + 60 * minutes).ok, true)
})

test('🔴 그렇다고 성공도 아니다 — 연속실패를 0 으로 되돌리지 않는다', () => {
  const s = { ...emptyState(), failStreak: 2 }
  const n = recordRun(s, { result: '제한', tookSec: 3 }, { failStreakMax: 3 }, base)
  assert.equal(n.failStreak, 2, '진짜 실패 2회가 제한 한 번으로 지워지면 안 된다')
})

test('제한도 하루 횟수에는 센다 (프로세스를 띄웠으니 시도는 시도다)', () => {
  const n = recordRun(emptyState(), { result: '제한', tookSec: 3 }, {}, base)
  assert.equal(n.byDay['2026-09-22'], 1)
})

test('진짜 실패는 여전히 연속실패를 올린다', () => {
  const n = recordRun({ ...emptyState(), failStreak: 2 }, { result: 'fail', tookSec: 3 }, { failStreakMax: 3 }, base)
  assert.equal(n.failStreak, 3)
  assert.ok(n.blocked, '진짜 고장은 차단되어야 한다')
})

test('isLimitFailure — 제한 문구를 알아본다', () => {
  assert.equal(isLimitFailure("You've hit your session limit · resets 1:30pm"), true)
  assert.equal(isLimitFailure('Error: usage limit reached'), true)
  assert.equal(isLimitFailure('rate limit exceeded, resets later'), true)
})

test('🔴 isLimitFailure — 모르면 false (진짜 고장을 제한으로 감추지 않는다)', () => {
  for (const s of ['', null, undefined, 'ENOENT', 'permission denied', 'limit']) {
    assert.equal(isLimitFailure(s), false, `${JSON.stringify(s)} 를 제한으로 보면 고장이 묻힌다`)
  }
})

/* ── ④ 제한에 잘려 멈췄나 ──────────────────────────────────── */

const synthetic = (label) => ({ model: '<synthetic>', content: [{ type: 'text', text: label }] })

test('🔴 제한 알림을 알아본다 (실측 표본)', () => {
  assert.equal(isLimitNotice(synthetic("You've hit your session limit · resets 1:30pm (Asia/Seoul)")), true)
  assert.equal(isLimitNotice(synthetic('You have reached your weekly usage limit')), true)
})

test('🔴 제한 알림이 아닌 것을 제한이라 하지 않는다 (놀던 세션을 깨운다)', () => {
  assert.equal(isLimitNotice(synthetic('API Error: connection reset')), false, 'reset 만으로는 제한이 아니다')
  assert.equal(isLimitNotice({ model: 'claude-opus-5', content: [{ type: 'text', text: 'usage limit' }] }), false,
    '진짜 모델의 답에 그 말이 나와도 제한 알림이 아니다')
  for (const x of [null, undefined, {}, { model: '<synthetic>' }]) {
    assert.equal(isLimitNotice(x), false)
  }
})

test('🔴 마지막 엔트리가 제한 알림일 때만 "제한으로 멈춤" 이다', () => {
  const acc = emptyTotals('s', 'slug')
  foldEntry(acc, { type: 'assistant', message: { model: 'claude-opus-5', content: [] }, timestamp: '2026-09-22T11:00:00Z' })
  assert.equal(acc.stoppedByLimit, false)

  foldEntry(acc, { type: 'assistant', message: synthetic("You've hit your session limit · resets 1:30pm"), timestamp: '2026-09-22T11:30:00Z' })
  assert.equal(acc.stoppedByLimit, true, '제한에 잘린 채 멈춰 있다')
  assert.ok(acc.limitNoticeAt, '언제 잘렸는지도 남겨야 한다')
})

test('🔴 제한 뒤에 작업이 이어졌으면 "멈춤"이 아니다 (실측: 이 PC 의 두 세션)', () => {
  const acc = emptyTotals('s', 'slug')
  foldEntry(acc, { type: 'assistant', message: synthetic("You've hit your session limit"), timestamp: '2026-09-18T11:29:00Z' })
  assert.equal(acc.stoppedByLimit, true)

  // 제한이 풀린 뒤 사람이 이어서 썼다
  foldEntry(acc, { type: 'user', message: { content: '계속하자' }, timestamp: '2026-09-19T20:00:00Z' })
  assert.equal(acc.stoppedByLimit, false, '이미 이어졌는데 또 깨우면 안 된다')
  assert.ok(acc.limitNoticeAt, '겪었다는 사실은 남는다 — 멈춰 있다와는 다르다')
})

/* ── 재개가 실제로 이 규칙들을 쓰는가 ──────────────────────── */

// 지시문은 lib/prompt.mjs 로 옮겼다(resume.mjs 가 400줄을 넘어서). 둘을 함께 본다 —
// '화면이 무엇을 한다'를 확인하려는 것이지 '어느 파일에 있다'를 보려는 게 아니다.
const resumeSource = ['src/resume.mjs', 'src/lib/prompt.mjs']
  .map((f) => readFileSync(join(ROOT, ...f.split('/')), 'utf8')).join(String.fromCharCode(10))
const resumeSrc = resumeSource.split('\n')
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
  .join('\n')

/**
 * 🔴 판정은 lib/resume-gate.mjs 한 곳에 있고, **불러서** 확인한다
 *   (test/resume-gate.test.mjs). 여기서는 재개가 그 판정을 쓰는지만 본다 —
 *   규칙을 두 벌 만들면 화면과 실제가 다른 말을 하게 된다(실제로 그랬다).
 */
test('🔴 재개가 공용 판정을 쓴다 (자기만의 규칙을 다시 만들지 않는다)', () => {
  assert.match(resumeSrc, /import \{ resumeGate \} from '\.\/lib\/resume-gate\.mjs'/)
  assert.match(resumeSrc, /const g = resumeGate\(\{/)
  assert.ok(!/if \(limitInfo\.limited\)/.test(resumeSrc), '제한 판정을 여기서 또 하면 안 된다')
})

test('🔴 화면도 같은 판정을 쓴다 (예산만 보고 "준비"라고 말하던 자리다)', () => {
  const sv = readFileSync(join(ROOT, 'src', 'lib', 'session-view.mjs'), 'utf8')
  assert.match(sv, /resumeGate\(\{/, '화면이 제 나름대로 판정하면 실제와 갈라진다')
  // 실행 중 확인은 fail-closed 로 넘겨야 한다 — 모르면 "돌고 있다"
  assert.match(sv, /running: true, isCertain: false/, '조회 실패를 "정지"로 넘기면 안 된다')
})

test('🔴 지시문이 "제한에 끊겼다"를 세션에 알려준다', () => {
  assert.match(resumeSrc, /limitStopped: v\.limitStopped/, '판정 결과를 지시문에 넘겨야 한다')
  assert.match(resumeSource, /사용량 제한에 걸려 중간에 끊겼다/, '무엇 때문에 끊겼는지 말해야 한다')
  assert.match(resumeSource, /이미 끝난 일이었다면 아무것도 하지 말고/,
    '이미 끝났으면 멈추라고 해야 한다 — 없으면 할 일 없이도 일을 만든다')
})

test('🔴 제한 결과는 스케줄러 이력을 빨갛게 물들이지 않는다', () => {
  assert.match(resumeSrc, /notOurFault = result === 'limited' \|\| result === 'overload'/,
    '제한과 과부하를 한 이름으로 묶어야 한다')
  assert.match(resumeSrc, /if \(result !== 'ok' && !notOurFault\) exitCode = 1/,
    '제한·과부하는 exit 1 이 아니다')
})

test('실행 중 확인은 그대로 남아 있다 (③ — 세션이 열려 있으면 안 민다)', () => {
  assert.match(resumeSrc, /running: sessionRunning\(ctx\.running, target\.sessionId, isAlive\)/,
    '실제 pid 로 확인한 결과를 판정에 넘겨야 한다')
  const gate = readFileSync(join(ROOT, 'src', 'lib', 'resume-gate.mjs'), 'utf8')
  assert.match(gate, /if \(running\?\.running\) return no\(GATE\.running/)
})
