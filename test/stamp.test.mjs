/**
 * stamp.test.mjs — 시각 표기를 고정한다.
 *
 * 🔴 로컬 시간이어야 한다. UTC 로 적었다가 KST 기준 9시간 낡아 보여
 *   "하트비트가 죽었다"고 오판한 실측 사고가 있었다(2026-09-17).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localStamp, dayKey, minuteOfDay, minutesSince, parseHhmm } from '../src/lib/stamp.mjs'

test('🔴 localStamp 는 로컬 시간이다 — UTC 가 아니다', () => {
  const d = new Date(2026, 8, 18, 16, 16, 40) // 로컬 2026-09-18 16:16:40
  assert.equal(localStamp(d), '2026-09-18 16:16:40')
  assert.notEqual(localStamp(d), d.toISOString().slice(0, 19).replace('T', ' '))
})

test('localStamp 는 한 자리 값을 0으로 채운다', () => {
  assert.equal(localStamp(new Date(2026, 0, 2, 3, 4, 5)), '2026-01-02 03:04:05')
})

test('dayKey 는 로컬 날짜다 — 예산 집계가 자정에 바뀐다', () => {
  assert.equal(dayKey(new Date(2026, 8, 18, 23, 59, 59)), '2026-09-18')
  assert.equal(dayKey(new Date(2026, 8, 19, 0, 0, 1)), '2026-09-19')
})

test('minuteOfDay', () => {
  assert.equal(minuteOfDay(new Date(2026, 8, 18, 0, 0)), 0)
  assert.equal(minuteOfDay(new Date(2026, 8, 18, 23, 59)), 1439)
})

test('minutesSince 는 미래 값을 음수로 그대로 돌려준다 — 시계 어긋남을 감추지 않는다', () => {
  const now = 1_000_000_000
  assert.equal(minutesSince(now - 600_000, now), 10)
  assert.equal(minutesSince(now + 600_000, now), -10)
})

test('parseHhmm — 유효값', () => {
  assert.equal(parseHhmm('07:00'), 420)
  assert.equal(parseHhmm('23:30'), 1410)
  assert.equal(parseHhmm('0:05'), 5)
})

test('parseHhmm — 잘못된 값은 null (호출부가 fail-closed 로 처리한다)', () => {
  for (const bad of ['24:00', '12:60', '', null, undefined, '정오', '12', '12:5']) {
    assert.equal(parseHhmm(bad), null, `${JSON.stringify(bad)} 는 null 이어야 한다`)
  }
})
