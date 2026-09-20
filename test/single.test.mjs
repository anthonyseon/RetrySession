/**
 * single.test.mjs — 중복 실행 금지를 고정한다.
 *
 * 왜 중요한가
 *   같은 것이 둘 돌면 서로를 밟는다 — 하트비트 둘은 같은 JSON 을 덮어써 기록을 찢고,
 *   재시작 둘은 하루 예산을 두 배로 쓰며 워킹트리를 함께 고친다.
 *   예약의 MultipleInstances 는 스케줄러가 띄우는 것끼리만 막으므로,
 *   사람이 손으로 돌리거나 화면에서 "지금 실행"을 누른 경우는 이 락이 막아야 한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { 락경로, 락상태, 잡기 } from '../src/lib/single.mjs'

/** 시험 전용 이름 — 진짜 구성요소 락을 건드리지 않는다 */
const 이름 = () => `__test__${process.pid}_${Math.random().toString(36).slice(2, 8)}`
const 심기 = (n, v) => writeFileSync(락경로(n), JSON.stringify(v))
const 치우기 = (n) => { try { rmSync(락경로(n), { force: true }) } catch { /* 없으면 됐다 */ } }

test('락이 없으면 잡힌다', () => {
  const n = 이름()
  try {
    const r = 잡기(n)
    assert.equal(r.ok, true)
    assert.ok(existsSync(락경로(n)))
  } finally { 치우기(n) }
})

test('🔴 살아 있는 프로세스가 잡고 있으면 막는다', () => {
  const n = 이름()
  try {
    // 이 프로세스는 분명히 살아 있다
    심기(n, { pid: process.pid, at: '2026-09-21 00:00:00', atEpoch: Date.now() })
    const r = 잡기(n)
    assert.equal(r.ok, false)
    assert.match(r.why, /이미 돌고 있다/)
    assert.match(r.why, new RegExp(String(process.pid)))
  } finally { 치우기(n) }
})

test('죽은 프로세스의 락은 회수한다', () => {
  const n = 이름()
  try {
    심기(n, { pid: 999_999_999, at: 'x', atEpoch: Date.now() })
    assert.equal(잡기(n).ok, true)
  } finally { 치우기(n) }
})

test('🔴 낡음 한계를 넘기면 살아 있어도 회수한다 (죽은 락에 영원히 막히지 않게)', () => {
  const n = 이름()
  try {
    심기(n, { pid: process.pid, at: 'x', atEpoch: Date.now() - 200 * 60_000 })
    assert.equal(잡기(n, { 낡음분: 30 }).ok, true)
  } finally { 치우기(n) }
})

test('한계 안이면 막는다 (경계 확인)', () => {
  const n = 이름()
  try {
    심기(n, { pid: process.pid, at: 'x', atEpoch: Date.now() - 5 * 60_000 })
    assert.equal(잡기(n, { 낡음분: 30 }).ok, false)
  } finally { 치우기(n) }
})

test('깨진 락 파일은 낡은 것으로 보고 회수한다', () => {
  const n = 이름()
  try {
    writeFileSync(락경로(n), '깨짐{{{')
    assert.equal(잡기(n).ok, true)
  } finally { 치우기(n) }
})

test('락상태 — 점유/낡음/나이를 구별해 알려준다', () => {
  const n = 이름()
  try {
    심기(n, { pid: process.pid, at: 'x', atEpoch: Date.now() - 3 * 60_000 })
    const s = 락상태(n, 30)
    assert.equal(s.점유, true)
    assert.equal(s.낡음, false)
    assert.equal(s.pid, process.pid)
    assert.ok(s.나이분 >= 2 && s.나이분 <= 4)

    심기(n, { pid: 999_999_999, at: 'x', atEpoch: Date.now() })
    const d = 락상태(n, 30)
    assert.equal(d.점유, false, '죽은 pid 는 점유가 아니다')
    assert.equal(d.낡음, true)
  } finally { 치우기(n) }
})

test('락이 없으면 점유도 낡음도 아니다', () => {
  const s = 락상태(이름(), 30)
  assert.equal(s.점유, false)
  assert.equal(s.낡음, false)
  assert.equal(s.pid, null)
})
