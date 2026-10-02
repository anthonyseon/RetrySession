/**
 * cli-async.test.mjs — CLI 를 **막지 않고** 부르는 길(callJsonAsync · refreshAccount).
 *
 * 🔴 왜 있나 (2026-10-02): «이 PC 에서 돌 수 있나» 의 «다시 확인» 이 로그인을 지금 다시 읽는다.
 *   동기 호출(execFileSync)은 CLI 가 늦으면 그만큼(최대 20초) 서버의 한 스레드를 멈추고,
 *   그동안 /api/ping 이 늦어 start.ps1·트레이가 서버를 죽었다고 읽는다 — 이 저장소가 겪은 사고다.
 * 🔴 두 길은 **같은 말**을 해야 한다 — 실패 문구가 갈리면 같은 고장을 창구마다 다르게 말한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { callJsonAsync } from '../src/lib/cli.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

test('JSON 을 받으면 ok 와 data 를 준다', async () => {
  const r = await callJsonAsync(['-e', 'console.log(JSON.stringify({ loggedIn: true }))'], { bin: process.execPath })
  assert.deepEqual(r, { ok: true, data: { loggedIn: true } })
})

test('🔴 실행 파일이 없으면 동기 쪽과 **같은 문구**로 말한다 (깨진 글자를 옮기지 않는다)', async () => {
  const bin = join(tmpdir(), 'rs-no-such-dir', 'claude.exe')
  const r = await callJsonAsync(['auth', 'status', '--json'], { bin, timeout: 5000 })
  assert.equal(r.ok, false)
  assert.equal(r.data, null)
  assert.match(r.error, /claude CLI 를 실행할 수 없다/)
  assert.ok(r.error.includes(bin), '어느 실행 파일인지 적어야 고칠 수 있다')
})

test('JSON 이 아니면 실패로 담는다 (던지지 않는다)', async () => {
  const r = await callJsonAsync(['-e', 'console.log("not json")'], { bin: process.execPath })
  assert.equal(r.ok, false)
  assert.ok(r.error, '이유가 비면 안 된다')
})

test('🔴 refreshAccount 는 막지 않는 길을 쓰고, account() 와 **같은 캐시**에 넣는다', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'cli.mjs'), 'utf8')
  const i = src.indexOf('export async function refreshAccount')
  assert.ok(i > 0, 'refreshAccount 가 있어야 한다')
  const body = src.slice(i, src.indexOf('\n}', i))
  assert.match(body, /await callJsonAsync\(/, '동기 호출이면 «다시 확인» 이 서버를 멈춘다')
  assert.doesNotMatch(body, /\bcallJson\(/)
  // 따로 들고 있으면 «다시 확인» 직후 3초 폴링이 옛 값으로 되돌린다
  assert.match(body, /_cache\.set\('auth'/)
  assert.match(src, /cached\('auth'/, 'account() 가 같은 키를 읽어야 한다')
})
