/**
 * procs.test.mjs — 실행 중 claude.exe 의 명령행 해석을 고정한다.
 *
 * 왜 이 출처가 있는가 (실측)
 *   `claude agents --json` 이 세션 2개를 보고할 때 실제 claude.exe 는 **4개**였다.
 *   나머지 둘은 `--claude-in-chrome-mcp` 보조라 세션이 아닌 게 맞았지만,
 *   CLI 만 믿었으면 그 존재조차 몰랐다. "목록에 없다"는 물음의 답은 여기서 나온다.
 *
 * 표본은 전부 실측 명령행에서 줄인 것이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCmdline } from '../src/lib/procs.mjs'

const ext = 'c:\\Users\\u\\.vscode\\extensions\\anthropic.claude-code-2.1.263-win32-x64\\resources\\native-binary\\claude.exe'

test('🔴 세션 — VS Code 확장이 --resume 으로 띄운 것 (실측 pid 6096)', () => {
  const c = `${ext} --output-format stream-json --verbose --input-format stream-json` +
    ' --permission-prompt-tool stdio --resume=79e0e7e8-450b-4e3a-a9f1-0f44feec252b' +
    ' --permission-mode bypassPermissions --allow-dangerously-skip-permissions' +
    ' --add-dir c:\\dev\\Tests --add-dir c:\\dev\\Description'
  const p = parseCmdline(c)

  assert.equal(p.종류, '세션')
  assert.equal(p.sessionId, '79e0e7e8-450b-4e3a-a9f1-0f44feec252b')
  assert.equal(p.출처, 'VS Code 확장')
  assert.equal(p.확장버전, '2.1.263')
  assert.equal(p.권한모드, 'bypassPermissions')
  assert.equal(p.위험권한, true, '권한 우회는 사람이 알아야 한다 — 놓치면 안 된다')
  assert.deepEqual(p.addDirs, ['C:/dev/Tests', 'C:/dev/Description'])
})

test('🔴 보조 — --claude-in-chrome-mcp 는 세션이 아니다 (실측 pid 2284·31668)', () => {
  const p = parseCmdline(`${ext} --claude-in-chrome-mcp`)
  assert.equal(p.종류, 'mcp보조')
  assert.equal(p.sessionId, null)
  assert.equal(p.위험권한, false)
})

test('세션 — --resume 없이 새로 시작한 것도 세션이다 (stream-json 으로 가린다)', () => {
  const p = parseCmdline(`${ext} --output-format stream-json --input-format stream-json --setting-sources=user,project`)
  assert.equal(p.종류, '세션')
  assert.equal(p.sessionId, null, '아직 id 를 알 수 없다 — 그대로 알 수 없다고 답한다')
})

test('npm 판과 확장 판을 구별한다 (버전이 다를 수 있다 — 실측 2.1.246 vs 2.1.263)', () => {
  const p = parseCmdline('C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe --output-format stream-json')
  assert.equal(p.출처, 'npm')
  assert.equal(p.확장버전, null)
})

test('--add-dir 의 따옴표와 공백 경로를 읽는다', () => {
  const p = parseCmdline(`${ext} --output-format stream-json --add-dir "c:\\my dev\\A" --add-dir c:\\b`)
  assert.deepEqual(p.addDirs, ['C:/my dev/A', 'C:/b'])
})

test('--add-dir 가 = 형태여도 읽는다', () => {
  const p = parseCmdline(`${ext} --output-format stream-json --add-dir=c:\\x`)
  assert.deepEqual(p.addDirs, ['C:/x'])
})

test('--session-id 도 세션 id 로 인정한다', () => {
  const p = parseCmdline(`${ext} --output-format stream-json --session-id 11111111-2222-3333-4444-555555555555`)
  assert.equal(p.sessionId, '11111111-2222-3333-4444-555555555555')
})

test('--resume 가 --session-id 보다 우선한다 (실제로 이어받는 쪽이 resume 이다)', () => {
  const p = parseCmdline(`${ext} --resume=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee --session-id 11111111-2222-3333-4444-555555555555`)
  assert.equal(p.sessionId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
})

test('--dangerously-skip-permissions 만 있어도 위험권한이다', () => {
  assert.equal(parseCmdline(`${ext} --output-format stream-json --dangerously-skip-permissions`).위험권한, true)
})

test('알 수 없는 형태는 기타로 두고 세션이라 우기지 않는다', () => {
  const p = parseCmdline(`${ext} --version`)
  assert.equal(p.종류, '기타')
})

test('빈 명령행에도 던지지 않는다', () => {
  for (const v of [null, undefined, '']) {
    const p = parseCmdline(v)
    assert.equal(p.종류, '기타')
    assert.deepEqual(p.addDirs, [])
  }
})
