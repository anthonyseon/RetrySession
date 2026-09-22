/**
 * tracker.test.mjs — 재개 지점 판정을 고정한다.
 *
 * 재개규약: status 가 'doing' 인 항목이 중단 지점이다. 없으면 첫 'todo' 부터.
 * doing 은 한 번에 하나만.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpret, resumePrompt } from '../src/lib/tracker.mjs'

const 추적기 = (steps, extra = {}) => ({
  _resumeContract: "status가 'doing'인 항목이 중단 지점이다.",
  steps,
  ...extra,
})

test('doing 이 중단 지점이다', () => {
  const t = interpret(추적기([
    { id: 'A', status: 'done' },
    { id: 'B', status: 'doing', title: '하는 중', evidence: '절반' },
    { id: 'C', status: 'todo' },
  ]))
  assert.equal(t.ok, true)
  assert.equal(t.doing.id, 'B')
  assert.equal(t.완료표기, '1/3')
  assert.equal(t.전부완료, false)
})

test('doing 이 없으면 첫 todo 가 재개 지점이다', () => {
  const t = interpret(추적기([
    { id: 'A', status: 'done' },
    { id: 'B', status: 'todo' },
    { id: 'C', status: 'todo' },
  ]))
  assert.equal(t.doing, null)
  assert.equal(t.다음todo.id, 'B')
  assert.equal(t.전부완료, false)
})

test('전부 done 이면 전부완료 — 재개할 것이 없다', () => {
  const t = interpret(추적기([{ id: 'A', status: 'done' }, { id: 'B', status: 'done' }]))
  assert.equal(t.전부완료, true)
  assert.equal(t.완료표기, '2/2')
  assert.equal(t.remaining, 0)
})

test('doing 이 둘 이상이면 규약 위반을 알린다', () => {
  const t = interpret(추적기([
    { id: 'A', status: 'doing' },
    { id: 'B', status: 'doing' },
  ]))
  assert.deepEqual(t.doing위반, ['A', 'B'])
  assert.equal(t.doing.id, 'A', '위반이어도 첫 doing 을 지점으로 답한다')
})

test('doing 하나면 위반이 아니다', () => {
  const t = interpret(추적기([{ id: 'A', status: 'doing' }]))
  assert.equal(t.doing위반, null)
})

test('blocked 같은 다른 status 는 done 도 todo 도 아니다 — 전부완료가 아니다', () => {
  const t = interpret(추적기([{ id: 'A', status: 'done' }, { id: 'B', status: 'blocked' }]))
  assert.equal(t.전부완료, false, 'blocked 를 완료로 보면 막힌 일이 조용히 사라진다')
  assert.equal(t.doing, null)
  assert.equal(t.다음todo, null)
})

test('추적기가 깨졌으면 ok:false 이고 error 를 담는다', () => {
  assert.equal(interpret(null).ok, false)
  assert.match(interpret({}).error, /steps/)
  assert.match(interpret({ steps: '배열아님' }).error, /steps/)
})

test('evidence·title 은 길이를 잘라 담는다 — 로그가 터지지 않게', () => {
  const t = interpret(추적기([{ id: 'A', status: 'doing', title: 'x'.repeat(500), evidence: 'y'.repeat(500) }]))
  assert.equal(t.doing.title.length, 120)
  assert.equal(t.doing.evidence.length, 200)
})

test('nextAction 을 그대로 옮긴다', () => {
  const t = interpret(추적기([{ id: 'A', status: 'todo' }], { nextAction: '다음은 이것' }))
  assert.equal(t.nextAction, '다음은 이것')
})

/* ── 헤드리스에게 넘길 지시문 ────────────────────────────────── */

test('지시문 — doing 을 지점으로 명시하고 안전 규칙을 포함한다', () => {
  const t = interpret(추적기([{ id: 'W3-2', status: 'doing', title: '수정 적용', evidence: '64건 중 20건' }]))
  const p = resumePrompt(t, { tracker: '_plan/_resume/07-실행추적.json' })

  assert.match(p, /현재 doing: W3-2/)
  assert.match(p, /64건 중 20건/)
  assert.match(p, /_plan\/_resume\/07-실행추적\.json/)
  // 🔴 사람이 보고 있지 않은 실행이므로 이 두 규칙이 반드시 있어야 한다
  assert.match(p, /추측으로 진행하지 않는다/)
  assert.match(p, /force push/)
  assert.match(p, /사람이 보고 있지 않다/)
})

test('지시문 — doing 이 없으면 첫 todo 를 지점으로 말한다', () => {
  const t = interpret(추적기([{ id: 'X1', status: 'todo', title: '시작할 것' }]))
  const p = resumePrompt(t, { tracker: 't.json' })
  assert.match(p, /첫 todo: X1/)
})

test('지시문 — 추적기에 규약이 없으면 기본 규약을 넣는다', () => {
  const t = interpret({ steps: [{ id: 'A', status: 'doing' }] })
  assert.match(resumePrompt(t, { tracker: 't.json' }), /doing은 한 번에 하나만/)
})
