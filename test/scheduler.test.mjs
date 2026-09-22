/**
 * scheduler.test.mjs — 예약 작업의 결과 코드를 **바르게 읽는가.**
 *
 * 🔴 실측 사건 (2026-09-21)
 *   사용자가 «예약 작업이 실패로 끝났습니다 / 트레이 — 코드 4294967295 (0xffffffff)»
 *   를 보고했다. 그때 트레이는 멀쩡히 돌고 있었다.
 *
 *   정체는 우리 자신이었다. `Stop-Process -Force` 는 TerminateProcess(h, -1) 로
 *   프로세스를 끊고, 그 -1 을 부호 없는 32비트로 읽은 값이 4294967295 다.
 *   즉 `start.ps1 -Restart` 가 남긴 **정상 종료 기록**을 고장으로 보고한 것이다.
 *   스킬은 코드를 고칠 때마다 -Restart 를 시키므로, 개발 주기마다 거짓 경보가 떴다.
 *
 *   거짓 경보는 이 저장소가 반복해서 겪은 실패다(느린 것을 죽었다고 하기 ·
 *   멀쩡한 것을 응답 없다고 하기). 늑대를 외치는 감시는 없느니만 못하다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { uiSource } from './_ui-files.mjs'
import { currentAlerts } from '../src/lib/alerts.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(join(ROOT, 'src', 'lib', 'scheduler.mjs'), 'utf8')

/* ── 결과 코드 해석 ──────────────────────────────────────────── */

test('🔴 4294967295 를 숫자로 내버려 두지 않는다 (사용자가 본 그 값)', () => {
  assert.ok(src.includes('4294967295'), '해석표에 이 코드가 있어야 한다')
  const i = src.indexOf('4294967295:')
  const meaning = src.slice(i, i + 160)
  assert.match(meaning, /강제 종료/, '무슨 일이 있었는지 말해야 한다')
  assert.match(meaning, /-Stop|-Restart/, '누가 그렇게 만드는지 짚어야 조치할 수 있다')
})

test('🔴 사람이 멈춘 코드와 고장 코드를 나눈다', () => {
  assert.match(src, /const isStoppedResult = \(code\) => \[([^\]]*)\]/, 'isStoppedResult 판정이 있어야 한다')
  const items = /const isStoppedResult = \(code\) => \[([^\]]*)\]/.exec(src)[1]
  // 셋 다 "사람이 멈췄다"는 뜻이다 — 고장이 아니다
  for (const c of ['267014', '3221225786', '4294967295']) {
    assert.ok(items.includes(c), `중지 코드 ${c} 가 빠졌다`)
  }
  // 진짜 고장 코드는 들어가면 안 된다 — 넣으면 고장을 놓친다
  for (const c of ['3221225794', '2,']) {
    assert.ok(!items.includes(c), `고장 코드 ${c} 를 중지로 분류하면 진짜 실패를 놓친다`)
  }
})

test('🔴 지금 돌고 있으면 지난 회차의 종료 코드로 고장이라 하지 않는다', () => {
  assert.match(src, /healthy: isRunning \|\| isOkResult/,
    '오래 사는 작업은 "지금 도는가"가 "지난 회차가 어떻게 끝났나"를 이긴다')
  assert.match(src, /const isRunningState = /, '상태 문자열 판정이 있어야 한다')
})

test('상태 문자열을 엄격히 본다 — "NotRunning" 을 running 으로 읽으면 안 된다', async () => {
  // 정규식이 /running/i 였다면 'NotRunning' 도 참이 되어 멈춘 작업을 정상이라 한다
  const m = /const isRunningState = \(state\) => (.*)/.exec(src)
  assert.ok(m, 'isRunningState 를 찾을 수 없다')
  assert.ok(/\^running\$/i.test(m[1]), `느슨한 매칭이다: ${m[1].trim()}`)
})

/* ── 경보 문구 ───────────────────────────────────────────────── */

const tasks = (v) => ({ sessions: [], locks: {}, totals: { runKnown: true }, tasks: { tray: v } })

test('🔴 돌고 있는 작업에는 경보를 내지 않는다 (사용자가 겪은 거짓 경보)', () => {
  const a = currentAlerts(tasks({
    name: 'EasyAI-RetrySession-Tray', registered: true, isRunning: true,
    healthy: true, stopped: false, lastResult: 4294967295, resultText: '강제 종료됨(-1)',
  }))
  assert.equal(a.length, 0, `돌고 있는데 경보가 떴다: ${JSON.stringify(a)}`)
})

test('🔴 멈춰 있으면 "실패"가 아니라 "멈춰 있다"고, 되살리는 법과 함께 말한다', () => {
  const a = currentAlerts(tasks({
    name: 'EasyAI-RetrySession-Tray', registered: true, isRunning: false,
    healthy: false, stopped: true, lastResult: 4294967295,
    resultText: '강제 종료됨(-1) — start.ps1 -Stop/-Restart 가 이렇게 끝낸다',
  }))
  const hit = a.find((x) => x.code === '예약중지')
  assert.ok(hit, '멈춤을 알리는 경보가 있어야 한다')
  assert.ok(!a.some((x) => x.code === '예약실패'), '멈춘 것을 실패라고 부르면 안 된다')
  assert.match(hit.desc, /-Restart/, '무엇을 하면 되는지 적어야 한다')
})

test('진짜 실패는 여전히 실패라고 말한다 (구별하느라 놓치면 안 된다)', () => {
  const a = currentAlerts(tasks({
    name: 'EasyAI-RetrySession-Tray', registered: true, isRunning: false,
    healthy: false, stopped: false, lastResult: 3221225794, resultText: '시작 실패 — DLL 초기화 오류',
  }))
  assert.ok(a.find((x) => x.code === '예약실패'), '고장은 고장이라고 해야 한다')
})

test('미등록은 그대로 미등록이다', () => {
  const a = currentAlerts(tasks({ name: 'X', registered: false }))
  assert.ok(a.find((x) => x.code === '예약미등록'))
})

/* ── 화면이 트레이를 보여주는가 ──────────────────────────────── */

test('🔴 경보가 말하는 작업은 화면에도 있어야 한다 (트레이 타일)', () => {
  const app = uiSource()
  const m = /for \(const \[key, label\] of \[([\s\S]*?)\]\) \{/.exec(app)
  assert.ok(m, 'OS 트리거 타일 목록을 찾을 수 없다')
  for (const k of ['heartbeat', 'restart', 'UI', 'tray']) {
    assert.ok(m[1].includes(`'${k}'`), `${k} 타일이 없다 — 경보를 받고도 볼 곳이 없다`)
  }
})

test('화면이 멈춤과 실패를 다른 배지로 그린다', () => {
  const app = uiSource()
  assert.match(app, /w\.stopped.*멈춰 있음/s, '멈춤 배지가 있어야 한다')
})

/* ── 낡은 값을 먼저 주고 뒤에서 새로 읽는다 ─────────────────── */

/**
 * 🔴 실측 (2026-09-22, 전수 검증): 작업 조회 한 번이 **7.0초**다(PowerShell 기동 +
 *   ScheduledTasks 모듈 적재). 이 함수는 동기라 그동안 node 의 이벤트 루프가 멈춘다.
 *   그래서 아무것도 계산하지 않는 /api/ping 이 최대 **7.9초** 걸렸다(평소 17~20ms).
 *   /api/ping 은 .ps1 들이 **5초 제한**으로 살아있음을 판정하는 자리다 —
 *   멀쩡한 서버를 "응답 없음"으로 보고, 그 판정 때문에 트레이가 안 뜬 적이 있다.
 */
test('🔴 캐시가 낡아도 요청을 막지 않는다 (동기 7초를 요청 안에서 치르지 않는다)', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'scheduler.mjs'), 'utf8')
  assert.match(src, /function refreshAsync/, '뒤에서 새로 읽는 길이 있어야 한다')
  assert.match(src, /spawn\(/, '비동기여야 한다 — execSync 면 그대로 막힌다')
  const i = src.indexOf('export function taskState')
  const section = src.slice(i, i + 700)
  assert.match(section, /if \(hit\) \{\s*\n\s*refreshAsync\(\)/,
    '캐시가 있으면 낡았어도 즉시 돌려주고 갱신은 뒤로 미뤄야 한다')
  assert.match(section, /stale: true/, '낡은 값을 줬으면 낡았다고 말해야 한다')
  assert.match(section, /ageMs/, '얼마나 낡았는지 알려야 한다')
  // 값이 아예 없을 때(서버 기동 직후)만 동기로 기다린다
  assert.match(src.slice(i, i + 900), /const v = buildTaskTable\(query\(\)\)/)
})

test('🔴 갱신을 겹쳐 띄우지 않는다 (PowerShell 이 쌓인다)', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'scheduler.mjs'), 'utf8')
  assert.match(src, /let _refreshing = false/)
  assert.match(src, /if \(_refreshing\) return/)
})

/**
 * 🔴 보여주기용 조회와 판정용 조회는 캐시 수명이 다르다.
 *   화면은 15초 묵은 값을 써도 되지만("N초 전 갱신"이 적혀 있다), 재개 판정은
 *   매번 새로 읽어야 한다 — 묵은 값으로 사람이 쓰는 대화에 끼어들면 안 된다.
 */
test('🔴 화면용은 캐시를 길게, 판정용은 캐시 없이', () => {
  const status = readFileSync(join(ROOT, 'src', 'lib', 'status.mjs'), 'utf8')
  assert.match(status, /runningSessions\(\{ ttlMs: 15000 \}\)/, '화면용은 길게')
  assert.match(status, /claudeProcesses\(\{ ttlMs: 15000 \}\)/, '프로세스 목록도 마찬가지')

  const resume = readFileSync(join(ROOT, 'src', 'resume.mjs'), 'utf8')
  assert.match(resume, /runningSessions\(\{ ttlMs: 0 \}\)/, '판정용은 캐시를 쓰면 안 된다')
})
