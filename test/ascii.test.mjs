/**
 * ascii.test.mjs — 스케줄러가 건드리는 것은 전부 ASCII 여야 한다.
 *
 * 🔴 왜 시험으로 고정하는가 (실측 + 이 작업 중 재발)
 *   PowerShell 5.1 은 .ps1 을 ANSI 로 읽는다. 한글 한 자만 들어가도 파서가 죽는다.
 *   원본 계획에서 이 때문에 ASCII 진입점(08-hb.mjs)을 따로 만들었다.
 *   그런데 **이 도구를 만들면서 또 어겼다** — register-resume.ps1 주석에 한글을 적었다.
 *   사람이 지키는 규칙은 사람이 어긴다. 기계가 지키게 한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 파일에서 ASCII 밖의 바이트가 있는 줄 번호들 */
function nonAsciiLines(path) {
  const buf = readFileSync(path)
  const bad = []
  let line = 1
  for (const b of buf) {
    if (b === 0x0a) { line++; continue }
    if (b > 0x7f && !bad.includes(line)) bad.push(line)
  }
  return bad
}

/** 저장소 안의 모든 .ps1 (루트 + scripts/) — 위치로 예외를 두지 않는다 */
function allPs1() {
  const out = []
  for (const dir of ['', 'scripts']) {
    const full = dir ? join(ROOT, dir) : ROOT
    for (const f of readdirSync(full)) {
      if (f.endsWith('.ps1')) out.push({ rel: dir ? `${dir}/${f}` : f, path: join(full, f) })
    }
  }
  return out
}

test('🔴 모든 .ps1 은 순수 ASCII 다 (PowerShell 5.1 이 ANSI 로 읽는다)', () => {
  const files = allPs1()
  assert.ok(files.length >= 6, `.ps1 이 있어야 한다 — 찾은 것: ${files.length}`)

  for (const { rel, path } of files) {
    const bad = nonAsciiLines(path)
    assert.deepEqual(bad, [], `${rel} 의 ${bad.join(', ')}번 줄에 비ASCII 문자가 있다 — PowerShell 5.1 파서가 죽는다`)
  }
})

test('사용자가 만질 실행 파일이 루트에 있다 (start.ps1)', () => {
  const p = join(ROOT, 'start.ps1')
  assert.ok(existsSync(p), 'start.ps1 이 루트에 있어야 한다 — 사용자가 찾는 첫 파일이다')
  const src = readFileSync(p, 'utf8')
  // 이 세 갈래가 없으면 "쉽게 실행"이 아니다
  for (const sw of ['-Install', '-Stop', '-Status']) {
    assert.ok(src.includes(sw), `start.ps1 에 ${sw} 가 있어야 한다`)
  }
})

test('🔴 트레이가 읽는 라벨 파일의 키는 ASCII 다 (tray.ps1 이 코드에 적는다)', () => {
  const p = join(ROOT, 'config', 'ui-labels.json')
  assert.ok(existsSync(p), 'config/ui-labels.json 이 있어야 한다')
  const j = JSON.parse(readFileSync(p, 'utf8'))

  const check = (o, path = '') => {
    for (const k of Object.keys(o)) {
      // `_주의` 같은 메모 키는 코드가 읽지 않으므로 면제한다
      if (!k.startsWith('_')) {
        // eslint-disable-next-line no-control-regex
        assert.match(k, /^[\x20-\x7e]+$/, `키 '${path}${k}' 가 ASCII 가 아니다 — tray.ps1 이 참조할 수 없다`)
      }
      if (o[k] && typeof o[k] === 'object') check(o[k], `${path}${k}.`)
    }
  }
  check(j)
})

test('🔴 ASCII 스크립트가 읽는 엔드포인트의 응답 키는 ASCII 다', () => {
  const server = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')

  // /api/ping 과 /api/tray 는 .ps1 이 직접 속성명을 적는다. 한글 키를 넣으면
  // 그 .ps1 이 비ASCII 가 되어 PowerShell 5.1 파서가 죽는다(실측: 가동초).
  const ping = /p === '\/api\/ping'\) \{([\s\S]*?)\n    \}/.exec(server)
  assert.ok(ping, '/api/ping 핸들러를 찾을 수 없다')
  for (const m of ping[1].matchAll(/^\s*([^\s:,{}()]+):/gm)) {
    // eslint-disable-next-line no-control-regex
    assert.match(m[1], /^[\x20-\x7e]+$/,
      `/api/ping 의 키 '${m[1]}' 가 ASCII 가 아니다 — status.ps1 이 참조할 수 없다`)
  }
})

test('🔴 트레이는 /api/status 가 아니라 /api/tray 를 읽는다 (한글 속성명을 못 적는다)', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'tray.ps1'), 'utf8')
  assert.ok(src.includes('/api/tray'), 'tray.ps1 은 /api/tray 를 읽어야 한다')

  // 주석에서 두 경로를 대조해 설명하므로 코드 줄만 본다 — 주석까지 금지하면
  // 이유를 적을 수 없어 규칙의 근거가 사라진다
  const code = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
  assert.ok(!code.includes('/api/status'),
    'tray.ps1 의 코드가 /api/status 를 읽으면 한글 속성명을 참조해야 하므로 ASCII 규칙을 어긴다')
})

test('🔴 스케줄러가 부르는 진입점 경로는 ASCII 다', () => {
  for (const rel of ['src/hb.mjs', 'src/rs.mjs', 'src/ui/server.mjs']) {
    const p = join(ROOT, rel)
    assert.ok(existsSync(p), `${rel} 가 있어야 한다 — .ps1 이 이 경로를 가리킨다`)
    // eslint-disable-next-line no-control-regex
    assert.match(rel, /^[\x20-\x7e]+$/, `${rel} 경로에 비ASCII 가 있다`)
  }
})

test('진입점은 본체로 넘기기만 한다 — 로직을 여기 두면 ASCII 제약에 갇힌다', () => {
  for (const [rel, bodyText] of [['src/hb.mjs', 'heartbeat.mjs'], ['src/rs.mjs', 'resume.mjs']]) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    assert.ok(src.includes(bodyText), `${rel} 는 ${bodyText} 를 가져와야 한다`)
    const codeLines = src.split('\n').filter((l) => {
      const t = l.trim()
      return t && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//') && !t.startsWith('*/')
    })
    assert.equal(codeLines.length, 1, `${rel} 의 코드는 import 한 줄이어야 한다 — 실제: ${codeLines.length}줄`)
  }
})

test('.ps1 이 가리키는 작업 이름은 scheduler.mjs 와 일치한다', async () => {
  const { taskNames } = await import('../src/lib/scheduler.mjs')
  const pairCwd = [
    ['register-heartbeat.ps1', taskNames.heartbeat],
    ['register-resume.ps1', taskNames.restart],
    ['register-ui.ps1', taskNames.UI],
    ['register-tray.ps1', taskNames.tray],
  ]
  for (const [f, name] of pairCwd) {
    const src = readFileSync(join(ROOT, 'scripts', f), 'utf8')
    assert.ok(src.includes(name), `scripts/${f} 에 작업 이름 '${name}' 이 없다 — 화면이 엉뚱한 작업을 조회하게 된다`)
  }
  // 해제 스크립트는 셋 다 알아야 한다
  const un = readFileSync(join(ROOT, 'scripts', 'unregister-all.ps1'), 'utf8')
  for (const name of Object.values(taskNames)) {
    assert.ok(un.includes(name), `unregister-all.ps1 에 '${name}' 이 없다 — 지워지지 않고 남는다`)
  }
})

/**
 * 🔴 start.bat · stop.bat (사용자 요청 2026-10-02 — 사람이 실행·종료하는 두 파일, git 에 들어간다).
 *   cmd.exe 는 .bat 을 OEM 코드페이지로 읽고, LF 만 있는 파일에서는 레이블·괄호 블록을 잘못 읽는다.
 *   그리고 cmd 는 **넘겨주기만** 한다 — 오래 사는 것은 그 밑에서 돌지 않는다(CLAUDE.md §3-1).
 */
test('🔴 start.bat · stop.bat 은 ASCII · CRLF 이고, PowerShell 을 절대 경로로 불러 넘겨주기만 한다', () => {
  for (const [f, target] of [['start.bat', /-File "%~dp0start\.ps1"/], ['stop.bat', /-File "%~dp0scripts\\stop-all\.ps1"/]]) {
    const path = join(ROOT, f)
    assert.ok(existsSync(path), `${f} 가 없다 — 새로 받은 PC 에서 실행할 파일이다`)
    assert.deepEqual(nonAsciiLines(path), [], `${f} 에 ASCII 밖의 글자가 있다`)
    const text = readFileSync(path, 'latin1')
    assert.doesNotMatch(text, /(?<!\r)\n/, `${f} 에 CR 없는 줄바꿈이 있다 — .gitattributes 의 *.bat eol=crlf`)
    assert.match(text, /"%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/, 'PATH 를 믿지 않는다')
    assert.match(text, target)
    assert.doesNotMatch(text, /^\s*start\s/im, '`start` 로 띄우면 cmd 밑에 오래 사는 것이 생긴다')
  }
  assert.match(readFileSync(join(ROOT, '.gitattributes'), 'utf8'), /^\*\.bat\s+text\s+eol=crlf/m)
})

/* ── 콘솔 창 ─────────────────────────────────────────────────── */

/**
 * 🔴 실측 결함 (2026-09-21) — 사용자가 "command 창이 꼭 필요한가" 를 **두 번** 물었다.
 *
 *   첫 번째에 node 작업 셋(하트비트·재개·UI)을 runhidden.exe 로 돌렸는데
 *   **트레이 하나를 빼먹었다.** 트레이는 powershell.exe 를 직접 실행하고
 *   `-WindowStyle Hidden` 을 믿었다.
 *
 *   찾은 것: pid 39528 `powershell.exe -WindowStyle Hidden -File ...\tray.ps1`,
 *   창이 **보이는** 상태로 WindowsTerminal.exe 가 호스팅 중.
 *
 *   그 플래그로 안 되는 이유
 *     1. `-WindowStyle Hidden` 은 PowerShell **호스트 설정**이다. 콘솔은 그 전에
 *        Windows 가 이미 할당했고, Windows 11 기본 콘솔 호스트는 Windows Terminal
 *        이라 그 설정이 그 창을 제어하지 못한다.
 *     2. 트레이는 로그온 세션 내내 살아 있어서 창이 사라지지 않는다.
 *        5분 작업은 잠깐 번쩍이지만 트레이는 하루 종일 떠 있다.
 *
 *   숨기는 게 아니라 **만들지 않는 것**이 답이다 — 창 없는 실행기(/target:winexe)가 자식을
 *   CREATE_NO_WINDOW 로 띄운다. 할당하지 않으면 보여줄 것도 없다. 그 실행기는 처음엔
 *   runhidden.exe 였고, 2026-10-02 부터 `start.exe --hidden` 이다(실행 파일을 하나로 — 사용자 요청).
 *
 *   사람이 네 곳 중 하나를 빼먹었으니, 기계가 네 곳을 다 센다.
 */
const codeOf = (path) => readFileSync(path, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
const LAUNCHER = /Get-HiddenLauncher\b/

test('🔴 예약 작업 네 개 모두 창 없는 실행기(start.exe --hidden)를 거친다 (하나만 빼먹으면 창이 뜬다)', () => {
  for (const f of ['register-heartbeat.ps1', 'register-resume.ps1', 'register-ui.ps1', 'register-tray.ps1']) {
    const code = codeOf(join(ROOT, 'scripts', f))
    assert.ok(LAUNCHER.test(code), `scripts/${f} 가 Get-HiddenLauncher 를 쓰지 않는다`)
    // action 을 만드는 줄이 실행기를 가리키고, 스위치를 넘겨야 한다
    const action = code.split('\n').filter((l) => l.includes('New-ScheduledTaskAction'))
    assert.ok(action.length >= 1, `${f} 에서 action 을 찾을 수 없다`)
    assert.ok(action.some((l) => /-Execute \$hidden\b/.test(l)),
      `${f} 의 action 이 실행기를 거치지 않는다: ${action[0]?.trim().slice(0, 80)}`)
    assert.match(code, /\$HiddenSwitch \+ ' "'/, `${f} 가 ${'--hidden'} 을 넘기지 않는다 — start.ps1 이 대신 돈다`)
  }
})

test('🔴 콘솔 프로그램을 띄우는 곳은 -WindowStyle Hidden 만 믿지 않는다', () => {
  // Windows Terminal 이 기본 호스트면 그 플래그로는 창이 남는다.
  // 그 플래그를 쓰는 줄이 있어도 되지만, 반드시 창 없는 실행기 대안이 함께 있어야 한다.
  for (const f of ['tray.ps1', 'shortcut.ps1']) {
    const code = codeOf(join(ROOT, 'scripts', f))
    if (!/WindowStyle Hidden|WindowStyle', 'Hidden/.test(code)) continue
    assert.ok(LAUNCHER.test(code) && /\$HiddenSwitch/.test(code),
      `scripts/${f} 가 -WindowStyle Hidden 에만 기대고 있다 — start.exe --hidden 경로를 함께 둬라`)
  }
  const startSrc = codeOf(join(ROOT, 'start.ps1'))
  assert.ok(LAUNCHER.test(startSrc) && /\$HiddenSwitch/.test(startSrc), 'start.ps1 도 start.exe --hidden 을 알아야 한다')
})

/**
 * 🔴 «창 없는 실행기» 의 이유를 실행기 자체에서 센다 — 이름이 바뀌어도(runhidden → start.exe --hidden)
 *   지키는 것은 같다: 콘솔을 만들지 않고, 자식을 기다려 종료 코드를 돌려준다(작업 스케줄러가
 *   «실행 중» 과 실패 코드를 읽는다). 그리고 숨김 모드는 **AttachConsole 보다 먼저** 갈라야 한다.
 */
test('🔴 start.exe --hidden 은 콘솔을 만들지 않고, 자식을 기다려 종료 코드를 돌려준다', () => {
  const cs = readFileSync(join(ROOT, 'tools', 'Launcher.cs'), 'utf8')
  const body = cs.slice(cs.indexOf('private static int RunHidden('), cs.indexOf('private static string QuoteForWindows('))
  assert.ok(body.length > 100, 'RunHidden 을 찾지 못했다')
  assert.match(body, /CreateNoWindow = true/)
  assert.match(body, /UseShellExecute = false/, 'ShellExecute 는 CREATE_NO_WINDOW 를 따르지 않는다')
  assert.match(body, /WaitForExit\(\)/, '기다리지 않으면 서버가 도는 동안 작업이 «끝남» 으로 보인다')
  assert.match(body, /return p\.ExitCode/, '종료 코드를 버리면 작업 기록에 실패가 남지 않는다')
  const main = cs.slice(cs.indexOf('private static int Main('))
  assert.ok(main.indexOf('return RunHidden(') < main.indexOf('AttachConsole('),
    '숨김 모드는 부모 콘솔에 붙기 전에 갈라야 한다 — 예전 runhidden.exe 와 같게')
})

test('🔴 스위치 글자는 세 곳이 같다 (Launcher.cs · launcher-lib.ps1 · ready.mjs) — 어긋나면 새 빌드도 «낡음» 이다', async () => {
  const cs = readFileSync(join(ROOT, 'tools', 'Launcher.cs'), 'utf8')
  const ps = readFileSync(join(ROOT, 'scripts', 'launcher-lib.ps1'), 'utf8')
  const { HIDDEN_SWITCH } = await import('../src/lib/ready.mjs')
  assert.equal(/const string HiddenSwitch = "([^"]+)"/.exec(cs)?.[1], HIDDEN_SWITCH)
  assert.equal(/^\$HiddenSwitch = '([^']+)'/m.exec(ps)?.[1], HIDDEN_SWITCH)
  // start.ps1 은 한 줄표(-) 매개변수만 받는다 — 두 줄표 스위치가 실수로 넘어가 묶일 일이 없다
  assert.match(HIDDEN_SWITCH, /^--[a-z]+$/)
})

test('🔴 runhidden.exe 는 합쳐졌다 — 그것을 부르는 코드가 남지 않는다 (없는 파일을 찾다 창을 띄운다)', () => {
  assert.ok(!existsSync(join(ROOT, 'tools', 'RunHidden.cs')), 'RunHidden.cs 가 남아 있다 — 두 번째 exe 가 되살아난다')
  const files = ['start.ps1', ...readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.ps1')).map((f) => join('scripts', f))]
  for (const f of files) {
    const code = codeOf(join(ROOT, f))
    // build-exe.ps1 은 옛 사본을 **지우고**, stop-all.ps1 은 옛 등록이 남긴 실행기를 **끈다** — 이름은 알되 띄우지 않는다
    if (f.endsWith('build-exe.ps1') || f.endsWith('stop-all.ps1')) {
      assert.doesNotMatch(code, /Start-Process[^\n]*runhidden|-Execute[^\n]*runhidden|-FilePath[^\n]*runhidden/i, `${f} 가 runhidden 을 띄운다`)
      continue
    }
    assert.doesNotMatch(code, /runhidden/i, `${f} 가 아직 runhidden 을 부른다`)
  }
})
