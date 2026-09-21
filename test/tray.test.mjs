/**
 * tray.test.mjs — 트레이가 **화면을 붙잡지 않는가**, 메뉴가 **사라지는가**.
 *
 * 🔴 실측 결함 (2026-09-21)
 *   Poll 이 타이머 안에서 Invoke-RestMethod 를 그대로 불렀다. WinForms 타이머는
 *   **UI 스레드에서** 틱하고, 열린 컨텍스트 메뉴를 그리는 것도 같은 스레드다.
 *   요청이 도는 동안 메시지를 처리할 수 없으니 메뉴가 뜬 채로 멈췄다.
 *   드문 일이 아니었다 — /api/tray 실측이 0.65s · 0.70s · 1.86s(웜), 11.3s(콜드)다.
 *   5초마다 그만큼 얼었으니, 메뉴가 떠 있는 시간의 상당 부분이 멈춤이었다.
 *
 * 이 파일은 .ps1 을 실행하지 않고 소스의 약속만 본다(창이 필요한 코드다).
 * 그래도 되돌림은 막는다 — 되돌리면 같은 멈춤이 돌아온다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(join(ROOT, 'scripts', 'tray.ps1'), 'utf8')
/** 주석을 뺀 코드만 — 주석의 설명이 검사를 통과시키면 안 된다 */
const 코드 = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

test('🔴 상태 조회가 UI 스레드를 붙잡지 않는다 (동기 호출 금지)', () => {
  // 상태 두 곳(/api/tray, /api/ping)은 반드시 비동기로 가져온다
  for (const 경로 of ['/api/tray', '/api/ping']) {
    const 줄들 = 코드.split('\n').filter((l) => l.includes(경로))
    assert.ok(줄들.length, `${경로} 를 부르는 곳이 있어야 한다`)
    for (const l of 줄들) {
      assert.ok(!/Invoke-RestMethod|Invoke-WebRequest/.test(l),
        `${경로} 를 동기로 부르면 메뉴가 그 시간만큼 멈춘다: ${l.trim()}`)
    }
  }
  assert.match(코드, /GetStringAsync/, '비동기 요청을 써야 한다')
})

test('🔴 타이머는 기다리지 않고 완료 여부만 본다', () => {
  assert.match(코드, /IsCompleted/, '완료 확인으로 넘어가야 한다')
  assert.ok(!/\.Result\b[\s\S]{0,40}IsCompleted/.test(코드),
    '완료를 확인하기 전에 Result 를 읽으면 그 자리에서 기다리게 된다')
  // .Wait()/.GetAwaiter().GetResult() 는 곧 동기 대기다
  assert.ok(!/\.Wait\(\)|GetAwaiter\(\)/.test(코드), '작업을 기다리면 UI 스레드가 멈춘다')
})

test('느린 것을 죽었다고 하지 않는다 — 실패하면 ping 으로 되묻는다', () => {
  assert.match(코드, /Resolve-Failure/, '실패 처리를 따로 둬야 한다')
  const i = 코드.indexOf('function Resolve-Failure')
  const 구간 = 코드.slice(i, i + 400)
  assert.ok(구간.includes('/api/ping'), 'tray 가 실패하면 ping 으로 살아있는지 먼저 물어야 한다')
})

test('🔴 메뉴는 가만히 두면 스스로 닫힌다', () => {
  assert.match(코드, /menuIdleFrom/, '메뉴가 열린 뒤 흐른 시간을 봐야 한다')
  assert.match(코드, /\$menu\.Close\(\)/, '한계를 넘기면 닫아야 한다')
  assert.match(코드, /MenuIdleSeconds/, '한계를 이름 있는 값으로 둬야 고치기 쉽다')
})

test('메뉴를 읽는 중에는 닫히지 않는다 (마우스가 올라가 있으면 시간이 되감긴다)', () => {
  assert.match(코드, /\$menu\.Add_MouseMove/,
    '마우스 움직임이 없으면 읽는 도중에 사라진다')
})

test('🔴 바깥을 클릭하면 닫힌다 (트레이 메뉴는 포커스를 잃어도 남는 버릇이 있다)', () => {
  assert.match(코드, /AutoClose\s*=\s*\$true/, 'AutoClose 를 켜야 한다')
  assert.match(코드, /SetForegroundWindow/,
    '메뉴를 전면 창으로 만들지 않으면 포커스 상실 메시지가 오지 않아 메뉴가 남는다')
  assert.match(코드, /\$menu\.Add_Opened/, '열릴 때 적용해야 한다')
})

test('메뉴 전용 타이머는 짧다 — 상태 틱에 얹으면 "8초"가 8~13초가 된다', () => {
  const m = /\$menuTimer\.Interval\s*=\s*(\d+)/.exec(코드)
  assert.ok(m, '메뉴 타이머 간격을 찾을 수 없다')
  assert.ok(Number(m[1]) <= 1000, `메뉴 타이머가 ${m[1]}ms 다 — 1초 이하여야 한다`)
})

test('🔴 풍선 알림은 여전히 없다 (되살리지 마라 — 알림은 화면에서 본다)', () => {
  assert.ok(!/ShowBalloonTip/.test(코드), 'tray.ps1 에 ShowBalloonTip 을 되살리지 마라')
})

test('타이머 틱에서 새는 오류가 트레이를 죽이지 않는다', () => {
  const i = 코드.indexOf('function Poll')
  const 구간 = 코드.slice(i, i + 900)
  assert.ok(/try\s*\{/.test(구간), 'Poll 은 통째로 감싸야 한다 — 조용히 사라지는 감시가 최악이다')
})
