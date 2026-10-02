/**
 * autowatch.test.mjs — 새 세션에 **감시만** 자동으로 붙이는 판정.
 *
 * 🔴 왜 조심스러운가
 *   이 판정이 헐거우면 남의 세션까지 등록부에 쌓이고, 빡빡하면 새 세션이 조용히
 *   감시 없이 돈다. 둘 다 화면으로는 안 보인다 — 그래서 여기서 못 박는다.
 *   특히 **재시작을 자동으로 켜지 않는다**는 것이 이 파일의 핵심이다.
 *   감시는 기록만 하므로 잘못 켜도 손해가 없지만, 재시작은 돈을 쓰고 파일을 고친다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickAutoWatch } from '../src/lib/autowatch.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 설정된 저장소이고 autoWatch 를 켠 경우 */
const onRepo = () => ({ hasConfig: true, project: { id: 'X', heartbeat: { autoWatch: true } } })
const offRepo = () => ({ hasConfig: true, project: { id: 'X', heartbeat: { autoWatch: false } } })
const noConfig = () => ({ hasConfig: false, project: { id: '(미등록) c:\\x', heartbeat: {} } })

const session = (over = {}) => ({
  sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
  registered: false, running: true, runKnown: true,
  mainCwd: 'c:\\x', runCwd: 'c:\\x', title: 'T', slug: 's', ...over,
})

const ids = (list, resolve) => pickAutoWatch(list, resolve).map((s) => s.sessionId.slice(0, 8))

test('설정된 저장소에서 새로 뜬 세션에 붙인다', () => {
  assert.deepEqual(ids([session()], onRepo), ['aaaaaaaa'])
})

test('🔴 설정에 없는 폴더에는 붙이지 않는다 (아무 데서나 붙으면 남의 세션이 쌓인다)', () => {
  assert.deepEqual(ids([session()], noConfig), [])
})

test('🔴 저장소가 autoWatch 를 켜지 않았으면 붙이지 않는다 (기본은 꺼짐)', () => {
  assert.deepEqual(ids([session()], offRepo), [])
  assert.deepEqual(ids([session()], () => ({ hasConfig: true, project: { heartbeat: {} } })), [],
    'autoWatch 를 안 적었으면 켜지 않은 것이다')
})

test('🔴 이미 등록된 세션은 건드리지 않는다 (사람이 꺼둔 것을 되살리면 안 된다)', () => {
  assert.deepEqual(ids([session({ registered: true })], onRepo), [])
})

test('🔴 돌고 있지 않으면 붙이지 않는다 — 감시할 것이 없다', () => {
  assert.deepEqual(ids([session({ running: false })], onRepo), [])
})

test('🔴 실행 여부를 **모르면** 붙이지 않는다 (fail-closed)', () => {
  assert.deepEqual(ids([session({ running: true, runKnown: false })], onRepo), [],
    '모르는 상태로 등록부를 늘리지 않는다')
})

test('cwd 를 모르면 붙이지 않는다', () => {
  assert.deepEqual(ids([session({ mainCwd: null, runCwd: null })], onRepo), [])
})

test('값이 없어도 터지지 않는다', () => {
  assert.deepEqual(pickAutoWatch(undefined, onRepo), [])
  assert.deepEqual(pickAutoWatch([null, undefined], onRepo), [])
  assert.deepEqual(pickAutoWatch([session()], () => undefined), [], '해석이 실패하면 붙이지 않는다')
})

/* ── 🔴 재시작은 절대 자동으로 켜지 않는다 ───────────────────── */

test('🔴 자동으로 켜는 것은 감시뿐이다 — 재시작을 켜면 돈이 나간다', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'autowatch.mjs'), 'utf8')
  assert.match(src, /setMany\(.*\{ watch: true \}/, '감시만 켜야 한다')
  assert.ok(!/restart:\s*true/.test(src), '이 파일에 restart: true 가 있으면 안 된다')
})

test('🔴 하트비트는 설정이 켜져 있을 때만 이 길로 들어간다 (5분마다 공짜가 아닌 일을 하지 않는다)', () => {
  const hb = readFileSync(join(ROOT, 'src', 'heartbeat.mjs'), 'utf8')
  assert.match(hb, /const autoWatchOn = .*autoWatch === true/, '먼저 설정을 싸게 확인해야 한다')
  const at = hb.indexOf('autoWatchNew(')
  const gate = hb.indexOf('if (autoWatchOn)')
  assert.ok(gate > 0 && gate < at, 'autoWatchNew 는 반드시 설정 확인 뒤에 와야 한다')
})
