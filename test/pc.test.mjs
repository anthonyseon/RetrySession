/**
 * pc.test.mjs — PC 설정 판정.
 *
 * 🔴 왜 중요한가
 *   이 도구의 모든 것은 OS 예약 작업에서 돈다. **잠든 PC 는 아무것도 돌리지 않는다.**
 *   5분 감시가 그냥 멎고, 그 공백은 이 도구를 만들게 한 9시간 중단과 똑같이 보인다.
 *   실측(이 PC): 나흘 밤 각 84회(7시간 × 12) 기록, 공백 0 — 절전이 꺼져 있어서다.
 *
 * 🔴 이 기능은 **남의 PC 설정을 바꾼다.** 규칙 하나하나에 시험을 붙인다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pc판정, 적용인자, 복원인자, 사실상안함, 시간말, 수동안내 } from '../src/lib/pc.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 이 PC 에서 실제로 읽은 모양 (실측) */
const 좋은설정 = () => ({
  ok: true, wrote: false,
  standbyAc: 0, standbyDc: 0,
  hibernateAc: 0, hibernateDc: 2147483647,
  lidAc: null, lidDc: null,
  hibernateAvailable: false, hasBattery: true, lockedNow: false,
})
const 찾기 = (판정, 키) => 판정.목록.find((x) => x.키 === 키)

/* ── 값 해석 ─────────────────────────────────────────────────── */

test('0 은 "안 함"이다', () => {
  assert.equal(사실상안함(0), true)
  assert.equal(시간말(0), '안 함')
})

test('🔴 큰 값도 사실상 "안 함"이다 (OEM 이 2147483647 을 쓴다 — 실측)', () => {
  assert.equal(사실상안함(2147483647), true)
  assert.equal(시간말(2147483647), '안 함')
})

test('🔴 못 읽은 값(null)은 0 과 다르다 — "모름"이다', () => {
  assert.equal(사실상안함(null), false, 'null 을 "안 함"으로 보면 잠드는 PC 를 괜찮다고 한다')
  assert.equal(시간말(null), '모름')
})

test('실제 대기 시간은 사람이 읽게 적는다', () => {
  assert.equal(시간말(600), '10분 뒤')
  assert.equal(시간말(1800), '30분 뒤')
  assert.equal(시간말(7200), '2시간 뒤')
})

/* ── 판정 ────────────────────────────────────────────────────── */

test('🔴 전원 연결 상태에서 잠들면 치명이다 (감시가 그때 멎는다)', () => {
  const d = 좋은설정(); d.standbyAc = 600
  const v = pc판정(d)
  assert.equal(v.수준, 'crit')
  const x = 찾기(v, 'standbyAc')
  assert.equal(x.수준, 'crit')
  assert.match(x.왜, /예약 작업을 돌리지 않는다/, '왜 문제인지 말해야 한다')
  assert.equal(x.고칠수있나, true)
})

test('잠들지 않으면 통과', () => {
  const v = pc판정(좋은설정())
  assert.equal(찾기(v, 'standbyAc').수준, 'ok')
})

test('🔴 최대 절전이 꺼져 있으면 그 값으로 경고하지 않는다 (발동할 수 없다)', () => {
  const d = 좋은설정(); d.hibernateAvailable = false; d.hibernateAc = 600
  assert.equal(찾기(pc판정(d), 'hibernateAc').수준, 'ok')
})

test('최대 절전이 켜져 있고 시간이 걸려 있으면 치명이다', () => {
  const d = 좋은설정(); d.hibernateAvailable = true; d.hibernateAc = 1800
  assert.equal(찾기(pc판정(d), 'hibernateAc').수준, 'crit')
})

test('🔴 덮개 설정을 못 읽으면 "모름"이다 — 괜찮다고 하지 않는다', () => {
  const v = pc판정(좋은설정())          // 이 PC 는 덮개 항목이 없다(실측)
  const x = 찾기(v, 'lidAc')
  assert.equal(x.수준, 'unknown')
  assert.ok(!x.고칠수있나, '읽지도 못하는 값을 고치려 들면 안 된다')
  assert.match(x.왜, /직접 확인/, '무엇을 하라는지 말해야 한다')
})

test('덮개가 절전이면 경고하되 치명은 아니다 (덮고 나가지 않으면 무해하다)', () => {
  const d = 좋은설정(); d.lidAc = 1
  const x = 찾기(pc판정(d), 'lidAc')
  assert.equal(x.수준, 'warn')
  assert.equal(x.고칠수있나, true)
})

test('데스크톱에는 덮개 줄을 만들지 않는다', () => {
  const d = 좋은설정(); d.hasBattery = false
  assert.equal(찾기(pc판정(d), 'lidAc'), undefined)
})

/**
 * 🔴 배터리에서 절전을 끄면 배터리를 태운다. 그건 사용자의 PC 이지 우리 것이 아니다.
 */
test('🔴 배터리 설정은 보여주기만 하고 고치지 않는다', () => {
  // 덮개는 읽힌 것으로 고정한다 — 배터리 하나만 변수로 두기 위해서다
  const d = 좋은설정(); d.standbyDc = 900; d.lidAc = 0
  const v = pc판정(d)
  const x = 찾기(v, 'standbyDc')
  assert.equal(x.수준, 'info', '배터리 절전은 경고가 아니다 — 그게 맞는 동작이다')
  assert.ok(!v.고칠것.includes('standbyDc'), '배터리 값을 자동으로 바꾸면 안 된다')
  assert.equal(v.수준, 'ok', '배터리 절전만으로 전체 판정이 나빠지면 안 된다')
})

test('🔴 설정을 못 읽으면 괜찮다고 하지 않는다 (fail-closed)', () => {
  for (const s of [null, undefined, {}, { ok: false, 오류: 'powershell 없음' }]) {
    const v = pc판정(s)
    assert.equal(v.읽음, false)
    assert.equal(v.수준, 'unknown')
    assert.equal(v.고칠것.length, 0, '모르는 채로 고치려 들면 안 된다')
  }
})

/* ── 적용·복원 인자 ──────────────────────────────────────────── */

test('🔴 적용 인자에 배터리(Dc)가 절대 섞이지 않는다', () => {
  const a = 적용인자(['standbyAc', 'hibernateAc', 'lidAc', 'standbyDc'])
  assert.ok(!a.some((x) => /Dc$/.test(x)), `배터리 인자가 섞였다: ${a.join(' ')}`)
  assert.deepEqual(a, ['-StandbyAc', '0', '-HibernateAc', '0', '-LidAc', '0'])
})

test('고칠 것이 없으면 인자도 없다', () => {
  assert.deepEqual(적용인자([]), [])
})

test('🔴 복원은 백업에 있는 값만 되돌린다 (없는 값을 0 으로 만들지 않는다)', () => {
  assert.deepEqual(복원인자({ standbyAc: 600, hibernateAc: 0, lidAc: null }),
    ['-StandbyAc', '600', '-HibernateAc', '0'])
  assert.deepEqual(복원인자({}), [])
  assert.deepEqual(복원인자(null), [])
})

/* ── 안전 규칙이 코드에 남아 있는가 ─────────────────────────── */

const pcmjs = readFileSync(join(ROOT, 'src', 'pc.mjs'), 'utf8')
const ps1 = readFileSync(join(ROOT, 'scripts', 'pc-settings.ps1'), 'utf8')

test('🔴 기본 동작은 점검이다 — 묻지도 않고 바꾸지 않는다', () => {
  assert.match(pcmjs, /if \(!flag\('--apply'\)\)/, '--apply 없이는 바꾸지 않아야 한다')
})

test('🔴 바꾸기 전에 되돌릴 길을 먼저 만든다', () => {
  const i = pcmjs.indexOf('원자JSON쓰기(백업경로')
  const j = pcmjs.indexOf('적용인자(판정.고칠것)')
  assert.ok(i > 0 && j > 0, '백업과 적용을 모두 찾아야 한다')
  assert.ok(i < j, '백업이 적용보다 먼저여야 한다 — 되돌릴 수 없는 변경은 하지 않는다')
  assert.match(pcmjs, /되돌리기 기록을 저장하지 못했다[\s\S]{0,200}process\.exit\(1\)/,
    '백업에 실패하면 바꾸지 않고 끝내야 한다')
})

test('🔴 바꾼 뒤 다시 읽어 확인한다 (바꿨다고 말만 하면 안 된다)', () => {
  assert.match(pcmjs, /const 뒤 = 읽기\(적용인자/, '적용 후 다시 읽어야 한다')
  assert.match(pcmjs, /바꿨는데도 남아 있다/, '안 바뀌었으면 그렇게 말해야 한다')
})

test('🔴 .ps1 은 순수 ASCII 다', () => {
  for (const [i, b] of Buffer.from(ps1, 'utf8').entries()) {
    assert.ok(b <= 0x7f, `pc-settings.ps1 의 ${i}번째 바이트가 ASCII 가 아니다`)
  }
})

test('🔴 값 읽기는 로케일 라벨이 아니라 자리로 한다 (schtasks cp949 교훈)', () => {
  assert.match(ps1, /hex\[\$hex\.Count - 2\]/, '마지막 두 hex 를 AC/DC 로 읽어야 한다')
  assert.ok(!/Select-String 'AC |Current AC/.test(ps1), '영문 라벨에 기대면 한글 Windows 에서 깨진다')
})

test('🔴 별칭이 아니라 GUID 를 쓴다 (별칭은 PC 마다 없을 수 있다 — 실측)', () => {
  assert.match(ps1, /238c9fa8-0aad-41ed-83f4-97be242c8f20/, 'SUB_SLEEP GUID')
  assert.match(ps1, /29f6c1db-86da-48c5-9fdb-f2b67b1f44da/, 'STANDBYIDLE GUID')
})

test('창을 띄우지 않고 부른다', () => {
  assert.match(pcmjs, /windowsHide: true/)
})

test('수동 안내가 실제 경로를 짚는다', () => {
  const t = 수동안내().join('\n')
  assert.match(t, /전원 옵션/)
  assert.match(t, /덮개/)
  assert.match(t, /로그오프/, '잠금과 로그오프의 차이를 말해야 한다')
})
