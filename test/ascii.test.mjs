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

test('🔴 scripts/*.ps1 은 전부 순수 ASCII 다 (PowerShell 5.1 이 ANSI 로 읽는다)', () => {
  const dir = join(ROOT, 'scripts')
  const files = readdirSync(dir).filter((f) => f.endsWith('.ps1'))
  assert.ok(files.length >= 5, `.ps1 이 있어야 한다 — 찾은 것: ${files.length}`)

  for (const f of files) {
    const bad = 비ascii줄(join(dir, f))
    assert.deepEqual(bad, [], `scripts/${f} 의 ${bad.join(', ')}번 줄에 비ASCII 문자가 있다 — PowerShell 5.1 파서가 죽는다`)
  }
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
