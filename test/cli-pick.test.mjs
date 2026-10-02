/**
 * cli-pick.test.mjs — **설치본이 여럿일 때 어느 claude 를 띄우나.**
 *
 * 🔴 실측 결함 (2026-09-30)
 *   무인 재개가 7초에 튕겼다:
 *     `API Error: 400 Claude Code 2.1.246 does not support this model;
 *      version 2.1.280 or newer is required. Run 'claude update' …`
 *   이 기계에는 설치본이 둘이었다 — npm 전역 **2.1.246**(2026-08-26)과 VS Code 확장이 들고
 *   있는 **2.1.283**. 사람의 세션 15개가 모두 확장 것으로 돌고 있었고(실행 중 프로세스 실측)
 *   우리만 npm 것을 부르고 있었다. 같은 세션을 이어받는데 **버전이 다르면** 그 세션의
 *   모델을 지원하지 못한다. 경로 순서로 고르던 것이 원인이었다.
 *
 * 🔴 버전은 **실행하지 않고** 안다 — 확장은 폴더 이름에, npm 은 package.json 에 있다.
 *   실행해서 알아내면 회차마다 프로세스를 띄우게 되고, 그 자체가 느려진다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { claudeInstalls, claudeBin, newerVersion, binInfo } from '../src/lib/cli.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/* ── 버전 비교 ───────────────────────────────────────────────── */

test('🔴 버전은 자리마다 숫자로 견준다 (문자열 비교는 2.1.9 > 2.1.10 이 된다)', () => {
  assert.equal(newerVersion('2.1.283', '2.1.246'), '2.1.283')
  assert.equal(newerVersion('2.1.246', '2.1.283'), '2.1.283')
  assert.equal(newerVersion('2.1.9', '2.1.10'), '2.1.10', '문자열로 비교하면 여기서 틀린다')
  assert.equal(newerVersion('3.0.0', '2.9.9'), '3.0.0')
  assert.equal(newerVersion('2.1.283', '2.1.283'), '2.1.283')
})

test('모르는 버전은 아래로 본다 (모르는 것을 최신으로 대접하면 결함이 돌아온다)', () => {
  assert.equal(newerVersion('2.1.246', null), '2.1.246')
  assert.equal(newerVersion(null, '2.1.246'), '2.1.246')
})

/* ── 설치본 찾기·고르기 ─────────────────────────────────────── */

/** 가짜 기계 하나 — npm 전역 하나와 VS Code 확장 둘을 깐다 */
function fakeMachine({ npmVer = '2.1.246', extVers = ['2.1.283'] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'rs-home-'))
  const appdata = join(home, 'AppData', 'Roaming')
  if (npmVer) {
    const root = join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code')
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: npmVer }), 'utf8')
    writeFileSync(join(root, 'bin', 'claude.exe'), 'x', 'utf8')
  }
  for (const v of extVers) {
    const d = join(home, '.vscode', 'extensions', `anthropic.claude-code-${v}-win32-x64`, 'resources', 'native-binary')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'claude.exe'), 'x', 'utf8')
  }
  const saved = { APPDATA: process.env.APPDATA, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME }
  process.env.APPDATA = appdata
  process.env.USERPROFILE = home
  process.env.HOME = home
  return {
    home,
    restore() {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
      rmSync(home, { recursive: true, force: true })
    },
  }
}

test('🔴 설치본을 전부 찾고, 버전을 실행 없이 읽는다', () => {
  const m = fakeMachine()
  try {
    const list = claudeInstalls()
    assert.equal(list.length, 2, `둘을 찾아야 한다: ${JSON.stringify(list)}`)
    assert.deepEqual(list.map((x) => x.version).sort(), ['2.1.246', '2.1.283'])
    assert.deepEqual(list.map((x) => x.from).sort(), ['.vscode', 'npm'])
  } finally { m.restore() }
})

test('🔴 **가장 새것**을 고른다 — 경로 순서가 아니다 (이 결함이 7초 실패를 만들었다)', () => {
  const m = fakeMachine()
  try {
    const picked = claudeBin()
    assert.match(picked, /2\.1\.283/, `낡은 것을 고르면 400 으로 튕긴다: ${picked}`)
    assert.match(picked, /native-binary/, 'VS Code 확장 번들이 그 세션이 쓰는 것이다')
  } finally { m.restore() }
})

test('확장이 여러 판 깔려 있어도 가장 새것 (지운 판이 남아 있는 것이 보통이다)', () => {
  const m = fakeMachine({ extVers: ['2.1.100', '2.1.283', '2.1.9'] })
  try {
    assert.match(claudeBin(), /2\.1\.283/)
  } finally { m.restore() }
})

test('npm 것이 더 새것이면 그것을 고른다 (확장을 늘 앞세우지 않는다)', () => {
  const m = fakeMachine({ npmVer: '2.2.0', extVers: ['2.1.283'] })
  try {
    assert.match(claudeBin(), /node_modules/)
  } finally { m.restore() }
})

test('🔴 버전을 모르는 설치본은 최신으로 대접하지 않는다', () => {
  const m = fakeMachine({ npmVer: null, extVers: ['2.1.283'] })
  try {
    // package.json 이 깨진 npm 설치본을 하나 더 깐다
    const root = join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code')
    mkdirSync(join(root, 'bin'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{{깨진 JSON', 'utf8')
    writeFileSync(join(root, 'bin', 'claude.exe'), 'x', 'utf8')
    const list = claudeInstalls()
    assert.ok(list.some((x) => x.version === null), '버전을 모르는 것도 목록에는 있어야 한다')
    assert.match(claudeBin(), /2\.1\.283/, '버전을 아는 것 중에서 고른다')
  } finally { m.restore() }
})

test('아무것도 없으면 PATH 에 맡긴다 (그때는 그렇게 말하는 셈이다)', () => {
  const m = fakeMachine({ npmVer: null, extVers: [] })
  try {
    assert.equal(claudeBin(), 'claude')
  } finally { m.restore() }
})

test('명시한 경로는 언제나 이긴다 (설정으로 못 박을 수 있어야 한다)', () => {
  const m = fakeMachine()
  try {
    assert.equal(claudeBin('D:\\x\\claude.exe'), 'D:\\x\\claude.exe')
  } finally { m.restore() }
})

/* ── 로그가 스스로 증거가 되는가 ────────────────────────────── */

/**
 * 🔴 실측 결함 (2026-09-30): `400 … does not support this model` 이 났을 때 재시작 로그에는
 *   **어느 CLI 로 띄웠는지 없었다.** 그래서 프로세스 목록을 뒤지고 239MB 바이너리를 긁어야
 *   원인(설치본 둘 · 낡은 쪽으로 띄움)에 닿았다. 로그가 그 한 줄을 들고 있으면 즉시 갈린다.
 */
test('🔴 버전을 실행 없이 알아낸다 (로그 한 줄 때문에 프로세스를 띄우지 않는다)', () => {
  const m = fakeMachine()
  try {
    const info = binInfo()
    assert.equal(info.version, '2.1.283', '고른 것의 버전을 알아야 로그에 적을 수 있다')
    assert.equal(info.from, '.vscode', '어디서 온 설치본인지도 적는다')
    assert.match(info.path, /native-binary/)
  } finally { m.restore() }
})

test('명시한 경로는 버전을 몰라도 그대로 쓴다 (모르는 것을 지어내지 않는다)', () => {
  const m = fakeMachine()
  try {
    const info = binInfo('D:/x/claude.exe')
    assert.equal(info.path, 'D:/x/claude.exe')
    assert.equal(info.version, null, '설치본 목록에 없으면 버전은 모른다')
    assert.equal(info.from, 'override')
  } finally { m.restore() }
})

test('🔴 재시작 로그에 CLI 버전과 **그 세션이 쓰던 버전**을 나란히 적는다', () => {
  const src = readFileSync(join(ROOT, 'src', 'resume.mjs'), 'utf8')
  assert.match(src, /const bin = binInfo\(cfg\.claudeBin\)/, '고른 것을 알아야 적을 수 있다')
  assert.match(src, /CLI \$\{bin\.version/, '우리가 띄운 버전을 적어야 한다')
  assert.match(src, /그 세션이 쓰던 것 \$\{seen\}/, '견줄 대상이 같은 줄에 있어야 한다')
  assert.match(src, /우리가 더 낡다/, '우리가 낡은 경우를 그 줄에서 말해야 한다')
})

test('🔴 고른 exe 를 **그대로 넘겨** 띄운다 (두 번 고르면 로그가 실행과 갈린다)', () => {
  const src = readFileSync(join(ROOT, 'src', 'resume.mjs'), 'utf8')
  assert.match(src, /exe: bin\.path/, '로그에 적은 그 파일로 띄워야 한다')
  const run = readFileSync(join(ROOT, 'src', 'lib', 'claude-run.mjs'), 'utf8')
  assert.match(run, /const exe = given \|\| claudeBin\(cfg\.claudeBin\)/,
    '받은 것을 쓰고, 없을 때만 스스로 고른다')
})
