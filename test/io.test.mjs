/**
 * io.test.mjs — 상태 파일이 찢어지지 않는가 · 로그에 상한이 있는가.
 *
 * 🔴 왜 시험으로 고정하는가
 *   찢어진 state/targets.json 은 loadTargets() 를 던지게 하고, 그러면 하트비트와
 *   재개가 **둘 다** 멈춘다. 켜둔 감시가 통째로 사라지는데 알려주는 곳이 없다.
 *   "쓰다 죽는 일은 드물다"는 이유로 넘길 수 있는 결함이 아니다 —
 *   이 도구는 드문 일이 일어났을 때 살아 있으라고 만든 것이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeAtomic, writeJsonAtomic, appendLine } from '../src/lib/io.mjs'

const 임시 = () => mkdtempSync(join(tmpdir(), 'rs-io-'))

test('writeAtomic — 쓴 내용이 그대로 남는다', () => {
  const d = 임시()
  const p = join(d, 'a.json')
  writeJsonAtomic(p, { 감시: true })
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), { 감시: true })
})

test('writeAtomic — 이미 있는 파일을 덮어쓴다', () => {
  const d = 임시()
  const p = join(d, 'a.json')
  writeFileSync(p, '{"옛것":1}')
  writeJsonAtomic(p, { 새것: 2 })
  assert.deepEqual(JSON.parse(readFileSync(p, 'utf8')), { 새것: 2 })
})

test('🔴 writeAtomic — 임시 파일을 남기지 않는다 (남으면 state 가 쓰레기로 찬다)', () => {
  const d = 임시()
  for (let i = 0; i < 3; i++) writeJsonAtomic(join(d, 'a.json'), { i })
  assert.deepEqual(readdirSync(d), ['a.json'])
})

test('🔴 writeAtomic — 읽는 쪽은 반쯤 쓰인 내용을 볼 수 없다', () => {
  // 중간 상태를 직접 관측할 수는 없으므로 **불변식**으로 고정한다:
  // 목적지 경로에는 언제나 온전한 JSON 이 있거나 아예 없다. 임시 이름에만 쓰고
  // 이름 바꾸기로 나타나므로, 목적지에 잘린 내용이 실리는 창이 없다.
  const d = 임시()
  const p = join(d, 'big.json')
  const 큰것 = { 줄: Array.from({ length: 5000 }, (_, i) => `줄 ${i}`) }
  writeJsonAtomic(p, 큰것)
  // 파일이 있으면 반드시 파싱된다 — 이것이 깨지면 원자성이 깨진 것이다
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).줄.length, 5000)
})

test('appendLine — 줄이 쌓인다', () => {
  const d = 임시()
  const p = join(d, 'x.log')
  appendLine(p, 'ㄱ')
  appendLine(p, 'ㄴ')
  assert.deepEqual(readFileSync(p, 'utf8').split('\n').filter(Boolean), ['ㄱ', 'ㄴ'])
})

test('appendLine — 줄바꿈을 두 번 넣지 않는다', () => {
  const d = 임시()
  const p = join(d, 'x.log')
  appendLine(p, '이미 있음\n')
  assert.equal(readFileSync(p, 'utf8'), '이미 있음\n')
})

test('🔴 appendLine — 한계를 넘으면 회전한다 (로그는 끝없이 자란다)', () => {
  // 실측: heartbeat.log 가 3일에 95KB, 세션 하나당 연 11MB.
  const d = 임시()
  const p = join(d, 'x.log')
  const 한계 = 200
  for (let i = 0; i < 100; i++) appendLine(p, `줄 ${i} ${'가'.repeat(10)}`, { 최대바이트: 한계 })

  assert.ok(statSync(p).size <= 한계, `현재 로그가 한계를 넘었다: ${statSync(p).size} > ${한계}`)
  assert.ok(existsSync(`${p}.1`), '직전 세대(.1) 가 있어야 한다 — 회전했다는 증거다')
  // 두 세대만 남긴다. 세 번째가 생기면 상한이 없는 것과 같다.
  assert.equal(existsSync(`${p}.2`), false, '세대는 둘까지다')
  // 가장 최근 줄은 살아 있어야 한다 — 회전이 최신 기록을 먹으면 안 된다
  assert.ok(readFileSync(p, 'utf8').includes('줄 99'), '마지막 줄이 남아 있어야 한다')
})

test('appendLine — 회전은 직전 세대만 밀어낸다 (.1 이 새 것으로 바뀐다)', () => {
  const d = 임시()
  const p = join(d, 'x.log')
  for (let i = 0; i < 200; i++) appendLine(p, `줄 ${i}`, { 최대바이트: 100 })
  const 이전 = readFileSync(`${p}.1`, 'utf8')
  assert.ok(!이전.includes('줄 0'), '아주 오래된 줄은 밀려나 있어야 한다')
})
