/**
 * http.test.mjs — 화면의 문지기. 이 시험들은 **돈과 파일**을 지킨다.
 *
 * 🔴 이 화면은 `claude --resume` 을 띄운다. 즉 아무나 누르면 내 계정으로 토큰을 쓰고
 *   내 워킹트리를 고친다. 그 문을 지키는 판정은 사람 눈이 아니라 시험이 지켜야 한다.
 *
 * 실측 결함(2026-09-21): 고치기 전에는 아래 '교차 출처' 사례가 전부 통과했다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { uiSource } from './_ui-files.mjs'
import { isLocal, originOk } from '../src/lib/http.mjs'
import { isSessionId } from '../src/lib/targets.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HOST = '127.0.0.1', PORT = 7345

/* ── 출처 (CSRF) ─────────────────────────────────────────────── */

test('🔴 다른 사이트에서 온 요청을 거절한다 (실측으로 통과하던 공격 모양)', () => {
  for (const o of [
    'https://evil.example',
    'http://evil.example',
    'https://127.0.0.1.evil.example',   // 접두가 같아 보이는 이름
    'http://127.0.0.1:7346',            // 같은 호스트, 다른 포트
    'https://127.0.0.1:7345',           // 같은 호스트·포트, 다른 스킴
    'http://localhost:7346',
  ]) {
    assert.equal(originOk(o, HOST, PORT), false, `${o} 를 받아들이면 안 된다`)
  }
})

test('🔴 Origin 이 null 이면 거절한다 (샌드박스 iframe·data: 가 출처를 숨긴 것이다)', () => {
  assert.equal(originOk('null', HOST, PORT), false)
})

test('내 화면에서 온 요청은 받는다 — 막으면 화면이 아무것도 못 한다', () => {
  assert.equal(originOk('http://127.0.0.1:7345', HOST, PORT), true)
  assert.equal(originOk('http://localhost:7345', HOST, PORT), true)
})

test('Origin 이 없으면 받는다 (curl·PowerShell — 이미 이 PC 에서 도는 것이다)', () => {
  // 브라우저는 교차 출처 요청에 Origin 을 반드시 붙이므로, 없다는 것은 브라우저가
  // 아니라는 뜻이다. 여기서 막으면 status.ps1·tray.ps1 이 전부 죽는다.
  for (const o of [undefined, null, '']) {
    assert.equal(originOk(o, HOST, PORT), true, `Origin=${String(o)} 를 막으면 점검 스크립트가 죽는다`)
  }
})

test('포트를 바꿔 띄워도 그 포트 기준으로 판정한다', () => {
  assert.equal(originOk('http://127.0.0.1:8080', HOST, 8080), true)
  assert.equal(originOk('http://127.0.0.1:7345', HOST, 8080), false)
})

/* ── 로컬 여부 ───────────────────────────────────────────────── */

test('🔴 바깥 주소에서 온 요청을 거절한다', () => {
  for (const ra of ['192.168.0.7', '10.0.0.1', '::ffff:192.168.0.7', '']) {
    assert.equal(isLocal({ remoteAddress: ra, host: '127.0.0.1:7345' }), false, `${ra} 를 받으면 안 된다`)
  }
})

test('🔴 Host 헤더가 남의 이름이면 거절한다 (DNS 리바인딩)', () => {
  assert.equal(isLocal({ remoteAddress: '127.0.0.1', host: 'evil.example:7345' }), false)
})

test('루프백 + 로컬 Host 는 받는다', () => {
  for (const [ra, h] of [
    ['127.0.0.1', '127.0.0.1:7345'],
    ['::1', 'localhost:7345'],
    ['::ffff:127.0.0.1', '127.0.0.1:7345'],
  ]) {
    assert.equal(isLocal({ remoteAddress: ra, host: h }), true, `${ra} / ${h} 는 받아야 한다`)
  }
})

/* ── 세션 id (경로가 되는 값) ────────────────────────────────── */

test('🔴 경로를 빠져나가는 세션 id 를 거절한다', () => {
  for (const bad of [
    '../../../../Windows/Temp/x',
    '..\\..\\x',
    'a/b',
    'a\\b',
    '.',
    '..',
    '',
    'C:/Windows',
    '794c2aee-ed0e-4e1c-a08f-8a0656dd54da/../..',
    null, undefined, 42, {},
  ]) {
    assert.equal(isSessionId(bad), false, `${JSON.stringify(bad)} 를 받아들이면 state 바깥에 쓴다`)
  }
})

test('진짜 세션 id 는 받는다 (실측 형태)', () => {
  for (const ok of [
    '794c2aee-ed0e-4e1c-a08f-8a0656dd54da',
    '8c3e7199-d618-4423-9c2f-42b0f0158d92',
    '8C3E7199-D618-4423-9C2F-42B0F0158D92',
  ]) {
    assert.equal(isSessionId(ok), true, `${ok} 를 막으면 화면이 세션을 못 연다`)
  }
})

test('🔴 앞자리만 준 id 도 API 에서는 거절한다 (여러 세션이 걸린다)', () => {
  // resume.mjs 의 --session 은 앞자리 맞춤을 지원한다. 그것을 HTTP 로 열어두면
  // "a" 하나로 a 로 시작하는 세션 전부를 밀 수 있다. CLI 편의와 API 는 다르다.
  assert.equal(isSessionId('794c2aee'), false)
})

/* ── 서버가 실제로 이 판정을 거치는가 ────────────────────────── */

test('🔴 server.mjs 가 모든 요청에서 두 판정을 거친다', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')
  assert.ok(src.includes('originOk'), 'server.mjs 가 출처 판정을 가져와야 한다')
  assert.ok(/originPasses\(req\)/.test(src), 'server.mjs 가 요청마다 출처를 봐야 한다')

  // 자체 판정을 따로 만들어 두면 lib 을 고쳐도 서버는 옛 판정을 쓴다
  assert.ok(!/function\s+originOk/.test(src), '서버가 출처 판정을 따로 구현하면 안 된다 — lib/http.mjs 하나다')
})

test('🔴 경로가 되는 값을 받는 엔드포인트는 전부 형태를 확인한다', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')
  // sessionId 를 다루는 네 곳 — 하나라도 빠지면 그 구멍으로 들어온다
  for (const piece of ['/api/session/', '/api/targets', '/api/targets/remove', '/api/rearm', '/api/run']) {
    const i = src.indexOf(`p === '${piece}'`) >= 0 ? src.indexOf(`p === '${piece}'`) : src.indexOf(piece)
    assert.ok(i > 0, `${piece} 핸들러를 찾을 수 없다`)
    const section = src.slice(i, i + 900)
    // 직접 부르든 공용 확인(아이디확인)을 거치든, 확인은 반드시 있어야 한다
    assert.ok(section.includes('isSessionId') || section.includes('checkIds'),
      `${piece} 가 세션 id 형태를 확인하지 않는다`)
  }
})

/**
 * 🔴 걸러낸 것을 말없이 버리지 않는다.
 *   실측 (2026-09-22): 잘못된 id 에 remove·rearm 이 {ok:true, 지움:0} 을 돌려줬다.
 *   같은 입력에 /api/targets 는 400 을 준다 — 같은 잘못에 다른 답을 주면
 *   "해제했다"고 믿은 채로 차단이 남는다.
 */
test('🔴 잘못된 sessionId 는 조용히 무시하지 않고 거절한다', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')
  assert.match(src, /const checkIds = /, '한 곳에서 판단해야 한다')
  for (const piece of ['/api/targets/remove', '/api/rearm']) {
    const i = src.indexOf(`p === '${piece}'`)
    const section = src.slice(i, i + 400)
    assert.ok(section.includes('bad.length) return json(res, 400'),
      `${piece} 가 400 으로 거절해야 한다`)
  }
})

/* ── CLI 실패 메시지 ─────────────────────────────────────────── */

test('🔴 깨진 인코딩의 오류 메시지를 그대로 옮기지 않는다 (실측)', async () => {
  const { failureText } = await import('../src/lib/cli.mjs')
  // 실측으로 나온 모양: cp949 를 UTF-8 로 읽어 대체문자가 박혔다
  const broken = "'claude'\uFFFD\uFFFD(\uFFFD\uFFFD) \uFFFD\uFFFD\uFFFD\uFFFD \uFFFD\uFFFDĴ\uFFFD\uFFFD"
  const r = failureText('claude', { stderr: broken, status: 1 })
  assert.ok(!r.includes('\uFFFD'), '읽을 수 없는 글자를 로그에 남기면 진단이 막힌다')
  assert.match(r, /claude CLI 를 실행할 수 없다/)
  assert.match(r, /exit 1/, '종료 코드는 남겨야 단서가 된다')
})

test('ENOENT 는 설치·경로 문제로 설명한다', async () => {
  const { failureText } = await import('../src/lib/cli.mjs')
  const r = failureText('C:/없는곳/claude.exe', { code: 'ENOENT', message: 'spawn ENOENT' })
  assert.match(r, /설치와 경로를 확인하라/)
  assert.ok(r.includes('C:/없는곳/claude.exe'), '어느 경로를 봤는지 알려줘야 한다')
})

test('알아볼 수 있는 stderr 는 보존한다', async () => {
  const { failureText } = await import('../src/lib/cli.mjs')
  const r = failureText('claude.exe', { stderr: 'Error: not logged in', status: 2 })
  assert.equal(r, 'Error: not logged in')
})

/* ── "정지"와 "모름"을 구별하는가 ────────────────────────────── */

/**
 * 조회 실패를 '정지'로 표시하면 사람이 "아무것도 안 돌고 있구나"라고 **정확히 반대로**
 * 이해한다. 실제로는 돌고 있는데 확인만 못 한 것일 수 있다.
 */
test('🔴 화면·기록·트레이가 조회 실패를 "정지"라고 말하지 않는다', () => {
  const app = uiSource()
  const hb = readFileSync(join(ROOT, 'src', 'heartbeat.mjs'), 'utf8')
  const tray = readFileSync(join(ROOT, 'scripts', 'tray.ps1'), 'utf8')

  assert.match(app, /runKnown === false/, '화면이 "모름"을 구별해야 한다')
  assert.match(hb, /실행여부모름/, '하트비트 기록이 "모름"을 남겨야 한다')
  assert.match(tray, /runningKnown/, '트레이가 "모름"을 구별해야 한다')
})

test('🔴 status.mjs 가 조회 성공 여부를 세션 판정에 넘긴다', () => {
  const st = readFileSync(join(ROOT, 'src', 'lib', 'status.mjs'), 'utf8')
  assert.match(st, /sessionView\(s, registry, runMap, ide\.windows, procMap, run\.ok\)/,
    'run.ok 를 넘기지 않으면 세션은 실패와 정지를 구별할 수 없다')
  assert.match(st, /runKnown: run\.ok/, '합계에도 담겨야 화면이 읽는다')
})

test('트레이가 읽는 새 키도 ASCII 다 (tray.ps1 이 코드에 적는다)', () => {
  const st = readFileSync(join(ROOT, 'src', 'lib', 'status.mjs'), 'utf8')
  const i = st.indexOf('export function trayStatus')
  const ret = st.slice(st.indexOf('return {', i), st.indexOf('\n}', i))
  for (const m of ret.matchAll(/^\s*([^\s:,{}()]+):/gm)) {
    // eslint-disable-next-line no-control-regex
    assert.match(m[1], /^[\x20-\x7e]+$/, `trayStatus 의 키 '${m[1]}' 가 ASCII 가 아니다`)
  }
})
