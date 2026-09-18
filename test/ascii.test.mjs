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
function 비ascii줄(path) {
  const buf = readFileSync(path)
  const bad = []
  let 줄 = 1
  for (const b of buf) {
    if (b === 0x0a) { 줄++; continue }
    if (b > 0x7f && !bad.includes(줄)) bad.push(줄)
  }
  return bad
}

/** 저장소 안의 모든 .ps1 (루트 + scripts/) — 위치로 예외를 두지 않는다 */
function 모든ps1() {
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
  const files = 모든ps1()
  assert.ok(files.length >= 6, `.ps1 이 있어야 한다 — 찾은 것: ${files.length}`)

  for (const { rel, path } of files) {
    const bad = 비ascii줄(path)
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

  const 검사 = (o, 경로 = '') => {
    for (const k of Object.keys(o)) {
      // `_주의` 같은 메모 키는 코드가 읽지 않으므로 면제한다
      if (!k.startsWith('_')) {
        // eslint-disable-next-line no-control-regex
        assert.match(k, /^[\x20-\x7e]+$/, `키 '${경로}${k}' 가 ASCII 가 아니다 — tray.ps1 이 참조할 수 없다`)
      }
      if (o[k] && typeof o[k] === 'object') 검사(o[k], `${경로}${k}.`)
    }
  }
  검사(j)
})

test('🔴 트레이는 /api/status 가 아니라 /api/tray 를 읽는다 (한글 속성명을 못 적는다)', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'tray.ps1'), 'utf8')
  assert.ok(src.includes('/api/tray'), 'tray.ps1 은 /api/tray 를 읽어야 한다')

  // 주석에서 두 경로를 대조해 설명하므로 코드 줄만 본다 — 주석까지 금지하면
  // 이유를 적을 수 없어 규칙의 근거가 사라진다
  const 코드 = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
  assert.ok(!코드.includes('/api/status'),
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
  for (const [rel, 본체] of [['src/hb.mjs', 'heartbeat.mjs'], ['src/rs.mjs', 'resume.mjs']]) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    assert.ok(src.includes(본체), `${rel} 는 ${본체} 를 가져와야 한다`)
    const 코드줄 = src.split('\n').filter((l) => {
      const t = l.trim()
      return t && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//') && !t.startsWith('*/')
    })
    assert.equal(코드줄.length, 1, `${rel} 의 코드는 import 한 줄이어야 한다 — 실제: ${코드줄.length}줄`)
  }
})

test('.ps1 이 가리키는 작업 이름은 scheduler.mjs 와 일치한다', async () => {
  const { 작업이름 } = await import('../src/lib/scheduler.mjs')
  const 짝 = [
    ['register-heartbeat.ps1', 작업이름.하트비트],
    ['register-resume.ps1', 작업이름.재시작],
    ['register-ui.ps1', 작업이름.UI],
    ['register-tray.ps1', 작업이름.트레이],
  ]
  for (const [f, name] of 짝) {
    const src = readFileSync(join(ROOT, 'scripts', f), 'utf8')
    assert.ok(src.includes(name), `scripts/${f} 에 작업 이름 '${name}' 이 없다 — 화면이 엉뚱한 작업을 조회하게 된다`)
  }
  // 해제 스크립트는 셋 다 알아야 한다
  const un = readFileSync(join(ROOT, 'scripts', 'unregister-all.ps1'), 'utf8')
  for (const name of Object.values(작업이름)) {
    assert.ok(un.includes(name), `unregister-all.ps1 에 '${name}' 이 없다 — 지워지지 않고 남는다`)
  }
})
