/**
 * tracker.test.mjs — 재개 지점 판정을 고정한다.
 *
 * 재개규약: status 가 'doing' 인 항목이 중단 지점이다. 없으면 첫 'todo' 부터.
 * doing 은 한 번에 하나만.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { interpret, resumePrompt, readTracker } from '../src/lib/tracker.mjs'

const tracker = (steps, extra = {}) => ({
  _resumeContract: "status가 'doing'인 항목이 중단 지점이다.",
  steps,
  ...extra,
})

test('doing 이 중단 지점이다', () => {
  const t = interpret(tracker([
    { id: 'A', status: 'done' },
    { id: 'B', status: 'doing', title: '하는 중', evidence: '절반' },
    { id: 'C', status: 'todo' },
  ]))
  assert.equal(t.ok, true)
  assert.equal(t.doing.id, 'B')
  assert.equal(t.doneMark, '1/3')
  assert.equal(t.allDone, false)
})

test('doing 이 없으면 첫 todo 가 재개 지점이다', () => {
  const t = interpret(tracker([
    { id: 'A', status: 'done' },
    { id: 'B', status: 'todo' },
    { id: 'C', status: 'todo' },
  ]))
  assert.equal(t.doing, null)
  assert.equal(t.nextTodo.id, 'B')
  assert.equal(t.allDone, false)
})

test('전부 done 이면 전부완료 — 재개할 것이 없다', () => {
  const t = interpret(tracker([{ id: 'A', status: 'done' }, { id: 'B', status: 'done' }]))
  assert.equal(t.allDone, true)
  assert.equal(t.doneMark, '2/2')
  assert.equal(t.remaining, 0)
})

test('doing 이 둘 이상이면 규약 위반을 알린다', () => {
  const t = interpret(tracker([
    { id: 'A', status: 'doing' },
    { id: 'B', status: 'doing' },
  ]))
  assert.deepEqual(t.doingViolations, ['A', 'B'])
  assert.equal(t.doing.id, 'A', '위반이어도 첫 doing 을 지점으로 답한다')
})

test('doing 하나면 위반이 아니다', () => {
  const t = interpret(tracker([{ id: 'A', status: 'doing' }]))
  assert.equal(t.doingViolations, null)
})

test('blocked 같은 다른 status 는 done 도 todo 도 아니다 — 전부완료가 아니다', () => {
  const t = interpret(tracker([{ id: 'A', status: 'done' }, { id: 'B', status: 'blocked' }]))
  assert.equal(t.allDone, false, 'blocked 를 완료로 보면 막힌 일이 조용히 사라진다')
  assert.equal(t.doing, null)
  assert.equal(t.nextTodo, null)
})

test('추적기가 깨졌으면 ok:false 이고 error 를 담는다', () => {
  assert.equal(interpret(null).ok, false)
  assert.match(interpret({}).error, /steps/)
  assert.match(interpret({ steps: '배열아님' }).error, /steps/)
})

test('evidence·title 은 길이를 잘라 담는다 — 로그가 터지지 않게', () => {
  const t = interpret(tracker([{ id: 'A', status: 'doing', title: 'x'.repeat(500), evidence: 'y'.repeat(500) }]))
  assert.equal(t.doing.title.length, 120)
  assert.equal(t.doing.evidence.length, 200)
})

test('nextAction 을 그대로 옮긴다', () => {
  const t = interpret(tracker([{ id: 'A', status: 'todo' }], { nextAction: '다음은 이것' }))
  assert.equal(t.nextAction, '다음은 이것')
})

/* ── 헤드리스에게 넘길 지시문 ────────────────────────────────── */

test('지시문 — doing 을 지점으로 명시하고 안전 규칙을 포함한다', () => {
  const t = interpret(tracker([{ id: 'W3-2', status: 'doing', title: '수정 적용', evidence: '64건 중 20건' }]))
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
  const t = interpret(tracker([{ id: 'X1', status: 'todo', title: '시작할 것' }]))
  const p = resumePrompt(t, { tracker: 't.json' })
  assert.match(p, /첫 todo: X1/)
})

test('지시문 — 추적기에 규약이 없으면 기본 규약을 넣는다', () => {
  const t = interpret({ steps: [{ id: 'A', status: 'doing' }] })
  assert.match(resumePrompt(t, { tracker: 't.json' }), /doing은 한 번에 하나만/)
})

/* ── 파일이 언제 바뀌었나 ───────────────────────────────────── */

/**
 * 🔴 사용자 질문 (2026-09-29): 「추적기는 갱신이 안되는가?」
 *
 *   읽기는 캐시가 없어 늘 최신이다(3초마다 파일을 새로 읽는다). 그런데 **파일 자체가
 *   며칠째 그대로일 수 있다** — 실측으로 설정이 가리킨 장부가 9/9 done 이고 파일 수정
 *   시각이 7일 전이었다. 그때 화면에 `9/9` 만 있으면 「지금 진행 중인 장부」로 읽힌다.
 *   RetrySession 은 이 파일을 **쓰지 않는다**(읽기 전용) — 갱신은 재개된 세션이 한다.
 *   그러니 최소한 «언제 바뀐 파일인가» 는 말해야 한다.
 */
test('🔴 읽을 때 파일의 수정 시각과 나이를 함께 돌려준다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rs-tracker-age-'))
  const p = join(dir, 't.json')
  writeFileSync(p, JSON.stringify({ steps: [{ id: '1', status: 'done' }] }), 'utf8')
  const t = readTracker(p)
  assert.match(t.fileAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, '사람이 읽는 시각이어야 한다')
  assert.ok(t.fileAgeMin >= 0 && t.fileAgeMin < 5, `방금 쓴 파일인데 ${t.fileAgeMin}분이라고 한다`)
  rmSync(dir, { recursive: true, force: true })
})

test('읽지 못한 경우에도 던지지 않는다 (나이를 몰라도 판정은 돌려준다)', () => {
  const t = readTracker(join(tmpdir(), '없는파일-rs.json'))
  assert.match(t.error, /읽을 수 없다/)
  assert.equal(t.fileAt, undefined, '모르는 것을 지어내지 않는다')
})
