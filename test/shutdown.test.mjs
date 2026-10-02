/**
 * shutdown.test.mjs — «완전 종료» 의 네 창구(stop.bat · 트레이 · 화면 · start.ps1 -Stop)와 그 본체.
 *
 * 🔴 사용자 요청 (2026-10-02): 종료하면 RetrySession 과 관련된 **모든** 프로세스·서비스가 멈춘다.
 *   네 창구가 «멈췄다» 를 다른 뜻으로 말하지 않게 본체는 scripts/stop-all.ps1 하나다.
 *   지키는 것:
 *   - 예약 작업을 **꺼 둔다** — 프로세스만 끄면 5분 감시가 새로 띄우고 로그온 때 화면·트레이가 돌아온다
 *   - 지우지 않는다 — -WithResume 같은 사람의 선택이 남는다(start.bat 이 다시 켠다)
 *   - 남의 것을 끄지 않는다 — 이 폴더를 연 VS Code·Claude Code 는 사람의 일이다(정확한 신원으로만 고른다)
 *   - 서버가 부를 때는 답을 먼저 보내고 띄운다(그 스크립트가 서버도 끈다 — 자기를 띄운 쪽은 마지막에)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startStopAll, stopCommand, stopperName } from '../src/lib/shutdown.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const codeOf = (text) => text.split('\n').filter((l) => !/^\s*(#|rem\b|::)/i.test(l)).join('\n')

/* ── 서버가 띄우는 길 (lib/shutdown.mjs) ─────────────────────── */

test('🔴 답을 먼저 돌려주고, 띄우기는 그 뒤로 미룬다 (그 스크립트가 이 서버도 끈다)', () => {
  const launched = []
  let scheduled = null
  const r = startStopAll('ui', { run: (c) => launched.push(c), later: (fn, ms) => { scheduled = { fn, ms } } })
  assert.equal(r.ok, true)
  assert.match(r.note, /start\.bat/, '다시 켜는 길을 함께 말한다')
  assert.equal(launched.length, 0, '답이 나가기 전에 띄우면 서버가 먼저 죽어 화면이 아무 말도 못 듣는다')
  assert.ok(scheduled.ms >= 200)
  scheduled.fn()
  assert.equal(launched.length, 1)
})

/**
 * 🔴 실측 결함 (2026-10-02): 처음엔 «서버와 끊어지게» detached:true 로 띄웠고, 이 시험이 그것을 고정했다.
 *   실제 브라우저에서 눌러 보니 화면은 «종료함» 인데 **아무것도 꺼지지 않았다** — DETACHED_PROCESS 의
 *   PowerShell 5.1 은 콘솔이 없어 스크립트를 한 줄도 돌리지 않는다(대조: detached 0/2 · 숨김 2/2 ·
 *   start.exe --hidden 2/2). 시험은 통과하고 있었다 — 틀린 것을 지키고 있었다.
 */
test('🔴 start.exe --hidden 으로(없으면 숨겨서) stop-all.ps1 을 띄운다 — detached 는 PowerShell 을 못 띄운다', () => {
  for (const has of [true, false]) {
    const c = stopCommand('ui', has)
    if (has) {
      assert.match(c.exe, /start\.exe$/i)
      assert.equal(c.args[0], '--hidden')
      assert.match(c.args[1], /powershell\.exe$/i)
    } else assert.match(c.exe, /powershell\.exe$/i)
    assert.match(c.args[c.args.indexOf('-File') + 1], /scripts[\\/]stop-all\.ps1$/)
    assert.equal(c.opts.detached, false, 'DETACHED_PROCESS 의 PowerShell 은 아무것도 안 하고 끝난다(실측)')
    assert.equal(c.opts.stdio, 'ignore')
    assert.equal(c.opts.windowsHide, true)
    assert.equal(c.opts.shell, false, 'cmd.exe 를 거치지 않는다(CLAUDE.md §3-1)')
  }
})

test('기록용 이름은 단어 하나만 받는다 — 모르는 값은 ui 로 읽는다', () => {
  assert.equal(stopperName('tray'), 'tray')
  for (const bad of [undefined, null, 42, '', 'a b', '"; rm', 'x'.repeat(40)]) assert.equal(stopperName(bad), 'ui')
  assert.deepEqual(stopCommand('"; evil').args.slice(-2), ['-By', 'ui'])
})

test('띄우다 던져도 서버는 죽지 않는다 (답은 이미 나갔다)', () => {
  let fn = null
  startStopAll('ui', { run: () => { throw new Error('ENOENT') }, later: (f) => { fn = f } })
  assert.doesNotThrow(() => fn())
})

test('🔴 서버의 /api/shutdown 은 by 를 읽고 202 로 답한다', () => {
  const server = read('src', 'ui', 'server.mjs')
  const i = server.indexOf("p === '/api/shutdown'")
  assert.ok(i > 0, '/api/shutdown 경로가 없다')
  const block = server.slice(i, i + 300)
  assert.match(block, /startStopAll\(b\.by\)/)
  assert.match(block, /json\(res, 202/)
})

/* ── 본체 (scripts/stop-all.ps1) ──────────────────────────────── */

const stopAll = () => codeOf(read('scripts', 'stop-all.ps1'))

test('🔴 예약 작업 넷을 **꺼 둔다** — 지우지 않는다 · 작업 끝내기(Stop-ScheduledTask)에 기대지 않는다', () => {
  const s = stopAll()
  for (const n of ['Heartbeat', 'Resume', 'UI', 'Tray']) assert.match(s, new RegExp(`'EasyAI-RetrySession-${n}'`), n)
  assert.match(s, /Disable-ScheduledTask/)
  assert.doesNotMatch(s, /Unregister-ScheduledTask/, '지우면 -WithResume 같은 사람의 선택이 사라진다')
  assert.doesNotMatch(s, /Stop-ScheduledTask/, '작업을 끝내면 그 프로세스 나무에 든 이 스크립트까지 끝날 수 있다')
})

test('🔴 남의 것을 끄지 않는다 — «RetrySession 이 들어 있다» 로 고르지 않는다 (VS Code·Claude Code 가 이 폴더를 연다)', () => {
  const s = stopAll()
  assert.doesNotMatch(s, /-like\s+'\*RetrySession\*'|Contains\('retrysession'\)/i)
  for (const piece of ['src\\ui\\server.mjs', 'src\\hb.mjs', 'src\\rs.mjs', 'scripts\\tray.ps1', 'browser-profile']) {
    assert.ok(s.includes(piece), `${piece} 로 정확히 골라야 한다`)
  }
  assert.match(s, /StartsWith\(\$rootLc \+ '\\'\)/, '실행기는 **이 폴더의** start.exe 만이다')
  assert.match(s, /child of a resume run/, '도는 재시작 회차가 띄운 claude 도 그 회차의 일부다')
})

test('🔴 자기를 띄운 쪽은 마지막에 끄고, 기다리는 실행기는 끄지 않는다 · 끝나면 확인하고 말한다', () => {
  const s = stopAll()
  const raw = read('scripts', 'stop-all.ps1')      // 절 표지(# ---- 3.)는 주석이라 원문에서 본다
  assert.ok(s.indexOf('Get-Ancestors') > 0)
  assert.ok(raw.indexOf('# ---- 3.') > 0 && raw.indexOf('-not $anc.ContainsKey') < raw.indexOf('# ---- 3.'), '조상이 아닌 것부터 끈다')
  assert.match(s, /\$ours\[\$k\] -like 'launcher\*'/, '출력을 중계하는 start.exe 를 끄면 이 스크립트의 출력이 끊긴다')
  for (const w of ['processes left', 'port', 'tray', 'tasks enabled']) assert.ok(s.includes(w), w)
  assert.match(s, /exit 0[\s\S]*exit 1/, '«끄라고 했다» 와 «꺼졌다» 를 구별한다')
})

/* ── 네 창구가 같은 본체를 부른다 ─────────────────────────────── */

test('🔴 stop.bat · 트레이 · 화면 · start.ps1 -Stop · 등록 해제가 모두 stop-all.ps1 하나를 부른다', () => {
  assert.match(codeOf(read('stop.bat')), /scripts\\stop-all\.ps1/)
  assert.match(codeOf(read('scripts', 'tray.ps1')), /scripts\\stop-all\.ps1/)
  assert.match(read('src', 'lib', 'shutdown.mjs'), /'stop-all\.ps1'/)
  const start = codeOf(read('start.ps1'))
  assert.match(start.slice(start.indexOf('if ($Stop)')), /^[\s\S]{0,200}stop-all\.ps1/)
  assert.match(codeOf(read('scripts', 'unregister-all.ps1')), /stop-all\.ps1/, '해제할 때 도는 재시작 회차를 남기지 않는다')
})

test('🔴 start.bat 은 꺼 둔 작업을 다시 켜고, 없는 것은 등록한다 — 재시작 작업은 절대 새로 등록하지 않는다', () => {
  assert.match(codeOf(read('start.bat')), /start\.ps1/)
  const raw = read('start.ps1')                     // 절 표지는 주석이라 원문에서 자르고, 그 안의 코드만 본다
  assert.ok(raw.indexOf('normal start') > 0 && raw.indexOf('# 1. server') > raw.indexOf('normal start'))
  const step0 = codeOf(raw.slice(raw.indexOf('normal start'), raw.indexOf('# 1. server')))
  assert.match(step0, /Enable-ScheduledTask/)
  assert.match(step0, /register-all\.ps1'\)/)
  assert.doesNotMatch(step0, /WithResume/, '토큰을 쓰는 작업은 사람이 -Install -WithResume 으로만 등록한다')
  assert.match(step0, /build-exe\.ps1/, '새로 받은 PC 에는 start.exe 가 없다(빌드 산출물)')
})

test('트레이 «종료» 는 확인을 받고, 문구는 ui-labels 에서 읽는다(키는 ASCII)', () => {
  const tray = codeOf(read('scripts', 'tray.ps1'))
  assert.match(tray, /Lbl 'menu\.stopAll'/)
  assert.match(tray, /MessageBox\]::Show\(\s*\(Lbl 'confirm\.stopAll'/)
  const labels = JSON.parse(read('config', 'ui-labels.json'))
  assert.match(labels.menu.stopAll, /종료/)
  assert.match(labels.confirm.stopAll, /start\.bat/)
  assert.notEqual(labels.menu.quit, '트레이 종료', '«종료» 와 «트레이 종료» 가 나란히 있으면 무엇이 다 끄는지 모른다')
})
