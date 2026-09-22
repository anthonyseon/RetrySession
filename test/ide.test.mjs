/**
 * ide.test.mjs — VS Code 창 짝짓기와 "열린 폴더 vs 세션" 설명을 고정한다.
 *
 * 이 시험이 있는 이유
 *   "Description 세션이 목록에 없다"는 물음이 실제로 나왔다. 답은 Description 이
 *   VS Code 에 **폴더로 열려 있지만 그 폴더에서 시작된 세션이 없다**는 것이었다
 *   (실측: 해당 슬러그에 .jsonl 이 0개, 세션은 EasyAI.Platform 에서 시작해 옮겨와 일했다).
 *   그 구별이 깨지면 같은 물음이 또 나온다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findWindow, sessionsByFolder } from '../src/lib/ide.mjs'
import { pathKey, isInside } from '../src/lib/config.mjs'

const windows = (port, folders, alive = true) => ({
  port, pid: 1000 + port, ideName: 'Visual Studio Code',
  workspaceFolders: folders.map(pathKey), alive, stale: !alive,
})

/* ── 경로 정규화 ─────────────────────────────────────────────── */

test('🔴 경로키 — 드라이브 문자 대소문자를 합친다 (실측: c:\\ 와 C:\\ 가 섞인다)', () => {
  assert.equal(pathKey('c:\\a\\b'), 'C:/a/b')
  assert.equal(pathKey('C:\\a\\b\\'), 'C:/a/b')
  assert.equal(pathKey('C:/a/b'), 'C:/a/b')
})

test('isInside — 같은 경로와 하위 경로', () => {
  assert.equal(isInside('C:/a/b', 'C:/a'), true)
  assert.equal(isInside('C:/a', 'C:/a'), true)
  assert.equal(isInside('c:\\a\\b\\c', 'C:/a/b'), true)
  assert.equal(isInside('C:/ab', 'C:/a'), false, '접두사가 같은 형제 폴더를 하위로 보면 안 된다')
  assert.equal(isInside('C:/x', 'C:/a'), false)
})

/* ── 창 짝짓기 ───────────────────────────────────────────────── */

test('세션 cwd 가 열린 폴더 안이면 그 창을 찾는다', () => {
  const w = findWindow('C:/repo/sub', [windows(63788, ['C:/repo'])])
  assert.equal(w.port, 63788)
})

test('🔴 낡은 lock 의 창은 짝짓지 않는다 — 닫힌 창을 열린 것으로 보이게 하면 안 된다', () => {
  assert.equal(findWindow('C:/repo/sub', [windows(44976, ['C:/repo'], false)]), null)
})

test('여러 창에 걸치면 가장 구체적인 폴더의 창을 고른다', () => {
  const items = [windows(1, ['C:/repo']), windows(2, ['C:/repo/sub'])]
  assert.equal(findWindow('C:/repo/sub/deep', items).port, 2)
})

test('열린 폴더 밖이면 null', () => {
  assert.equal(findWindow('C:/other', [windows(1, ['C:/repo'])]), null)
  assert.equal(findWindow(null, [windows(1, ['C:/repo'])]), null)
})

/* ── 열린 폴더별 세션 (Description 물음의 핵심) ──────────────── */

const sessions = (id, runCwd, mainCwd, opts = {}) => ({
  sessionId: id, runCwd: pathKey(runCwd), mainCwd: pathKey(mainCwd),
  running: !!opts.running, watch: { on: !!opts.watch },
})

test('🔴 폴더에서 일하지만 거기서 시작하지 않은 경우를 구별한다 (Description 의 경우)', () => {
  const items = [windows(63788, ['C:/dev/Platform', 'C:/dev/Description'])]
  const sessionList = [sessions('s1', 'C:/dev/Platform', 'C:/dev/Description', { running: true, watch: true })]
  const r = sessionsByFolder(items, sessionList)

  const platform = r.find((x) => x.folders === 'C:/dev/Platform')
  const desc = r.find((x) => x.folders === 'C:/dev/Description')

  assert.equal(platform.startedHere, 1, 'Platform 에서 시작했다')
  assert.equal(desc.sessionCount, 1, 'Description 에서 일하는 세션이 1개 있다')
  assert.equal(desc.startedHere, 0, '🔴 Description 에서 시작한 세션은 없다 — 이것이 목록에 없어 보이는 이유다')
  assert.equal(desc.running, 1)
  assert.equal(desc.watch, 1)
})

test('열려 있지만 아무 세션도 없는 폴더는 0 으로 나온다', () => {
  const r = sessionsByFolder([windows(1, ['C:/dev/Empty'])], [])
  assert.equal(r[0].sessionCount, 0)
  assert.equal(r[0].startedHere, 0)
})

test('낡은 창의 폴더는 집계하지 않는다', () => {
  const r = sessionsByFolder([windows(1, ['C:/dev/Old'], false)], [sessions('s', 'C:/dev/Old', 'C:/dev/Old')])
  assert.deepEqual(r, [])
})

test('같은 폴더가 두 창에 열려 있으면 한 줄로 합친다', () => {
  const r = sessionsByFolder(
    [windows(1, ['C:/dev/Shared']), windows(2, ['C:/dev/Shared'])],
    [sessions('s', 'C:/dev/Shared', 'C:/dev/Shared')],
  )
  assert.equal(r.length, 1, '같은 폴더가 두 줄로 보이면 세션이 두 배로 있는 것처럼 읽힌다')
  assert.match(String(r[0].port), /1.*2/)
})

test('세션이 많은 폴더가 위로 온다', () => {
  const items = [windows(1, ['C:/dev/A', 'C:/dev/B'])]
  const sessionList = [
    sessions('s1', 'C:/dev/B', 'C:/dev/B'),
    sessions('s2', 'C:/dev/B', 'C:/dev/B'),
  ]
  assert.equal(sessionsByFolder(items, sessionList)[0].folders, 'C:/dev/B')
})
