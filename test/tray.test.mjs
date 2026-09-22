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
  assert.match(코드, /Get(String)?Async\(/, '비동기 요청을 써야 한다')
})

/**
 * 🔴 실측 결함 (2026-09-21, 전수 검증 중)
 *   `GetStringAsync` 는 HTTP 500 도 예외로 던져서 **타임아웃과 구별할 수 없었다.**
 *   그래서 트레이는 500 을 받고 /api/ping 을 물어보고, ping 이 답하니 "느림"으로
 *   판정해 **직전의 초록 상태를 그대로 유지**했다. 500 은 느린 게 아니고 스스로
 *   낫지도 않는다 — 깨진 state/targets.json 이 정확히 이 상태를 만든다
 *   (loadTargets 가 일부러 던지므로 /api/status 와 /api/tray 가 둘 다 500 이다).
 *   멀쩡해 보이는 트레이 + 아무것도 안 나오는 화면. 최악의 조합이다.
 */
test('🔴 서버가 오류로 "답한 것"과 "답하지 않은 것"을 구별한다', () => {
  assert.match(코드, /IsSuccessStatusCode/,
    '상태 코드를 봐야 500 과 타임아웃을 가를 수 있다')
  assert.match(코드, /GetAsync\(/, 'GetStringAsync 는 500 도 예외로 던져 구별할 수 없다')
  assert.match(코드, /Resolve-HttpError/, '오류 응답 전용 처리가 있어야 한다')

  // 오류 응답은 crit 이어야 한다 — "느림"으로 흘리면 직전 색이 그대로 남는다
  const i = 코드.indexOf('function Resolve-HttpError')
  const 구간 = 코드.slice(i, i + 300)
  assert.match(구간, /Render 'crit'/, '오류 응답은 치명으로 그려야 한다')
  assert.ok(!/status\.slow/.test(구간), '오류를 "느림"으로 부르면 안 된다')
})

test('오류 응답 처리가 두 엔드포인트 모두에 걸린다', () => {
  // ping 이 500 이면 그것도 깨진 것이다. tray 응답에만 검사를 걸면 새는 길이 남는다
  const i = 코드.indexOf('function Poll')
  const 구간 = 코드.slice(i, i + 1200)
  const 성공검사 = 구간.indexOf('IsSuccessStatusCode')
  const ping분기 = 구간.indexOf("-eq 'ping'")
  assert.ok(성공검사 > 0 && ping분기 > 0, '두 판정을 모두 찾아야 한다')
  assert.ok(성공검사 < ping분기,
    '상태 코드 검사가 ping/tray 분기보다 먼저여야 두 엔드포인트에 모두 걸린다')
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

/* ── 살아있음 판정은 절대 무거운 집계에 얹지 않는다 ─────────── */

/**
 * 🔴 실측 사고 (2026-09-22) — 이 실수를 **세 번째** 했다.
 *   start.ps1 의 Test-Server 가 /api/tray 를 3초 타임아웃으로 물었다. 그 엔드포인트는
 *   상태 전체를 만들어 콜드 캐시에서 11.7초 걸린다. 그래서 멀쩡한 서버가
 *   "not answering on port 7345" 로 보고됐고, 그 경로가 `exit 1` 이라
 *   **트레이는 시작조차 못 했다.** 거짓 판정 하나가 멀쩡한 부품을 끌어내렸다.
 *
 *   status.ps1 은 이미 /api/ping 으로 고쳤는데 start.ps1 사본을 놓쳤다.
 *   사람이 사본을 놓치므로 기계가 전부 센다.
 */
test('🔴 살아있음을 묻는 모든 .ps1 이 /api/ping 을 쓴다 (사본을 놓치지 않게)', () => {
  const 파일 = ['start.ps1', 'scripts/status.ps1', 'scripts/register-ui.ps1', 'scripts/open-app.ps1']
  for (const f of 파일) {
    const p = join(ROOT, ...f.split('/'))
    let src
    try { src = readFileSync(p, 'utf8') } catch { continue }
    const 코드 = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')

    // 살아있음을 묻는 줄(짧은 타임아웃으로 HTTP 를 치는 줄)이 /api/tray 를 쓰면 안 된다
    for (const l of 코드.split('\n')) {
      if (!/Invoke-WebRequest|Invoke-RestMethod/.test(l)) continue
      if (!/api\/tray/.test(l)) continue
      assert.fail(`${f} 가 살아있음 확인에 /api/tray 를 쓴다 — 콜드 11.7초다: ${l.trim().slice(0, 90)}`)
    }
  }
})

test('🔴 거짓 "응답 없음" 하나가 트레이까지 죽이지 않게 한다', () => {
  const start = readFileSync(join(ROOT, 'start.ps1'), 'utf8')
  // Test-Server 는 값싼 엔드포인트를 써야 한다
  const i = start.indexOf('function Test-Server')
  const 구간 = start.slice(i, i + 700)
  assert.match(구간, /api\/ping/, 'Test-Server 는 /api/ping 을 써야 한다')
  assert.ok(!/api\/tray/.test(구간), 'Test-Server 에 /api/tray 가 남아 있으면 안 된다')
})
