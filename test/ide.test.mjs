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
import { 창찾기, 폴더별세션 } from '../src/lib/ide.mjs'
import { 경로키, 안에있나 } from '../src/lib/config.mjs'

const 창 = (포트, 폴더들, 살아있음 = true) => ({
  포트, pid: 1000 + 포트, ideName: 'Visual Studio Code',
  workspaceFolders: 폴더들.map(경로키), 살아있음, 낡음: !살아있음,
})

/* ── 경로 정규화 ─────────────────────────────────────────────── */

test('🔴 경로키 — 드라이브 문자 대소문자를 합친다 (실측: c:\\ 와 C:\\ 가 섞인다)', () => {
  assert.equal(경로키('c:\\a\\b'), 'C:/a/b')
  assert.equal(경로키('C:\\a\\b\\'), 'C:/a/b')
  assert.equal(경로키('C:/a/b'), 'C:/a/b')
})

test('안에있나 — 같은 경로와 하위 경로', () => {
  assert.equal(안에있나('C:/a/b', 'C:/a'), true)
  assert.equal(안에있나('C:/a', 'C:/a'), true)
  assert.equal(안에있나('c:\\a\\b\\c', 'C:/a/b'), true)
  assert.equal(안에있나('C:/ab', 'C:/a'), false, '접두사가 같은 형제 폴더를 하위로 보면 안 된다')
  assert.equal(안에있나('C:/x', 'C:/a'), false)
})

/* ── 창 짝짓기 ───────────────────────────────────────────────── */

test('세션 cwd 가 열린 폴더 안이면 그 창을 찾는다', () => {
  const w = 창찾기('C:/repo/sub', [창(63788, ['C:/repo'])])
  assert.equal(w.포트, 63788)
})

test('🔴 낡은 lock 의 창은 짝짓지 않는다 — 닫힌 창을 열린 것으로 보이게 하면 안 된다', () => {
  assert.equal(창찾기('C:/repo/sub', [창(44976, ['C:/repo'], false)]), null)
})

test('여러 창에 걸치면 가장 구체적인 폴더의 창을 고른다', () => {
  const 목록 = [창(1, ['C:/repo']), 창(2, ['C:/repo/sub'])]
  assert.equal(창찾기('C:/repo/sub/deep', 목록).포트, 2)
})

test('열린 폴더 밖이면 null', () => {
  assert.equal(창찾기('C:/other', [창(1, ['C:/repo'])]), null)
  assert.equal(창찾기(null, [창(1, ['C:/repo'])]), null)
})

/* ── 열린 폴더별 세션 (Description 물음의 핵심) ──────────────── */

const 세션 = (id, 실행cwd, 주작업cwd, opts = {}) => ({
  sessionId: id, 실행cwd: 경로키(실행cwd), 주작업cwd: 경로키(주작업cwd),
  실행중: !!opts.실행중, 감시: { 켜짐: !!opts.감시 },
})

test('🔴 폴더에서 일하지만 거기서 시작하지 않은 경우를 구별한다 (Description 의 경우)', () => {
  const 목록 = [창(63788, ['C:/dev/Platform', 'C:/dev/Description'])]
  const 세션들 = [세션('s1', 'C:/dev/Platform', 'C:/dev/Description', { 실행중: true, 감시: true })]
  const r = 폴더별세션(목록, 세션들)

  const platform = r.find((x) => x.폴더 === 'C:/dev/Platform')
  const desc = r.find((x) => x.폴더 === 'C:/dev/Description')

  assert.equal(platform.여기서시작, 1, 'Platform 에서 시작했다')
  assert.equal(desc.세션수, 1, 'Description 에서 일하는 세션이 1개 있다')
  assert.equal(desc.여기서시작, 0, '🔴 Description 에서 시작한 세션은 없다 — 이것이 목록에 없어 보이는 이유다')
  assert.equal(desc.실행중, 1)
  assert.equal(desc.감시, 1)
})

test('열려 있지만 아무 세션도 없는 폴더는 0 으로 나온다', () => {
  const r = 폴더별세션([창(1, ['C:/dev/Empty'])], [])
  assert.equal(r[0].세션수, 0)
  assert.equal(r[0].여기서시작, 0)
})

test('낡은 창의 폴더는 집계하지 않는다', () => {
  const r = 폴더별세션([창(1, ['C:/dev/Old'], false)], [세션('s', 'C:/dev/Old', 'C:/dev/Old')])
  assert.deepEqual(r, [])
})

test('같은 폴더가 두 창에 열려 있으면 한 줄로 합친다', () => {
  const r = 폴더별세션(
    [창(1, ['C:/dev/Shared']), 창(2, ['C:/dev/Shared'])],
    [세션('s', 'C:/dev/Shared', 'C:/dev/Shared')],
  )
  assert.equal(r.length, 1, '같은 폴더가 두 줄로 보이면 세션이 두 배로 있는 것처럼 읽힌다')
  assert.match(String(r[0].포트), /1.*2/)
})

test('세션이 많은 폴더가 위로 온다', () => {
  const 목록 = [창(1, ['C:/dev/A', 'C:/dev/B'])]
  const 세션들 = [
    세션('s1', 'C:/dev/B', 'C:/dev/B'),
    세션('s2', 'C:/dev/B', 'C:/dev/B'),
  ]
  assert.equal(폴더별세션(목록, 세션들)[0].폴더, 'C:/dev/B')
})
