/**
 * launch-roots.test.mjs — 재개를 **어디서 띄우고 어디까지 쓸 수 있게 하나.**
 *
 * 🔴 실측 결함 (2026-09-28). 첫 성공 재개가 **아무것도 남기지 못했다.**
 *     RUN 끝 · ok · 370초 · $18.271 · 턴 22 · exit 0 · 권한거부 11건
 *   요약은 "쓰기·git·node 가 전부 승인 대기라 durable 하게 남길 수 없다" 였고,
 *   디스크를 재 보니 그 6분 동안 바뀐 파일이 **0개**였다. 거부 사유가 결정적이었다:
 *     `Claude requested permissions to write to …\Description\_plan\_resume\07-실행추적.json`
 *   권한 모드가 아니라 **경로**였다. 그때의 값:
 *     cwd      = …\EasyAI.Platform   (등록부의 runCwd)
 *     --add-dir= …\EasyAI.Platform   (설정의 addDirs)
 *     추적기·대상 = …\Description\…
 *   같은 폴더를 두 번 허용하고, 정작 일할 폴더는 한 번도 허용하지 않았다.
 *
 *   그래서 뿌리를 **추적기를 소유한 저장소**로 맞춘다. 지시문이 말하는 경로가
 *   `project.repo` 기준이므로, 거기서 띄우지 않으면 "이 파일을 고쳐라"와 "그 파일을
 *   못 고친다"가 한 실행 안에서 동시에 참이 된다 — 돈과 시간만 쓰고 결과가 없다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launchRoots } from '../src/lib/claude-run.mjs'

/** 실측 그대로의 값 (등록부·설정에서 가져왔다) */
const REAL = {
  target: {
    runCwd: 'c:\\AnthoySeon\\Projects\\EasyAI.Platform\\Source\\260713\\Cnthoth-Dev\\EasyAI.Platform',
    mainCwd: 'C:/AnthoySeon/Projects/EasyAI.Platform/Source/260713/Cnthoth-Dev/Description',
  },
  project: {
    id: 'Description',
    repo: 'C:/AnthoySeon/Projects/EasyAI.Platform/Source/260713/Cnthoth-Dev/Description',
    tracker: '_plan/_resume/07-실행추적.json',
    resume: { addDirs: ['C:/AnthoySeon/Projects/EasyAI.Platform/Source/260713/Cnthoth-Dev/EasyAI.Platform'] },
  },
}

test('🔴 실측 사고 재현 — 추적기를 소유한 저장소에서 띄운다', () => {
  const { cwd, addDirs } = launchRoots(REAL.target, REAL.project)
  assert.equal(cwd, REAL.project.repo, 'cwd 가 추적기의 저장소여야 한다 (예전엔 runCwd 였다)')
  assert.ok(/Description$/.test(cwd), `Description 에서 띄워야 한다: ${cwd}`)
  // 세션이 일해 온 다른 폴더는 잃지 않는다
  assert.deepEqual(addDirs, [REAL.target.runCwd])
})

test('🔴 cwd 와 같은 폴더를 --add-dir 로 또 넘기지 않는다 (실측의 그 쓸모없는 중복)', () => {
  const { addDirs } = launchRoots(
    { runCwd: 'c:\\repo\\A', mainCwd: 'C:/repo/A' },
    { repo: 'c:/REPO/a', resume: { addDirs: ['C:\\repo\\A\\'] } })
  assert.deepEqual(addDirs, [],
    '대소문자·슬래시·끝 구분자가 달라도 같은 폴더다 — 세 가지 표기가 모두 걸러져야 한다')
})

test('세션이 일해 온 폴더는 cwd 밖이면 반드시 넘어간다', () => {
  const { cwd, addDirs } = launchRoots(
    { runCwd: 'c:/work/X', mainCwd: 'c:/work/Y' },
    { repo: 'c:/work/Z', resume: { addDirs: ['c:/work/W'] } })
  assert.equal(cwd, 'c:/work/Z')
  assert.deepEqual(addDirs, ['c:/work/X', 'c:/work/Y', 'c:/work/W'],
    'runCwd · mainCwd · 설정 순서로 더한다 (관측한 것 먼저, 사람이 넓힌 것 나중)')
})

test('같은 폴더가 여러 칸에 있어도 한 번만 넘긴다', () => {
  const { addDirs } = launchRoots(
    { runCwd: 'c:/a', mainCwd: 'c:/a' },
    { repo: 'c:/b', resume: { addDirs: ['c:/a', 'C:\\A'] } })
  assert.deepEqual(addDirs, ['c:/a'])
})

test('🔴 저장소를 모르면 관측한 폴더로 물러선다 (터지지 않는다)', () => {
  assert.equal(launchRoots({ runCwd: 'c:/a', mainCwd: 'c:/b' }, {}).cwd, 'c:/a')
  assert.equal(launchRoots({ mainCwd: 'c:/b' }, {}).cwd, 'c:/b')
  assert.equal(launchRoots({}, {}).cwd, null, '아무것도 없으면 null 로 말한다 — 거짓 경로를 만들지 않는다')
})

test('빈 입력·없는 필드에도 터지지 않는다', () => {
  assert.doesNotThrow(() => launchRoots())
  assert.doesNotThrow(() => launchRoots(null, null))
  assert.deepEqual(launchRoots().addDirs, [])
})

/**
 * 🔴 실행 로그에 무엇을 쓸 수 있었는지 남아야 한다.
 *   이번 사고를 추적할 수 있던 유일한 이유가 로그의 `cwd …` 한 줄이었다.
 *   `--add-dir` 이 없었으면 "권한거부 11건"의 원인을 트랜스크립트까지 파야 했다.
 */
test('🔴 재시작 로그가 cwd 와 --add-dir 을 함께 남긴다', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../src/resume.mjs', import.meta.url)), 'utf8')
  assert.match(src, /launchRoots\(target, v\.project\)/, '판정이 끝난 뒤 뿌리를 여기서 정해야 한다')
  assert.match(src, /cwd \$\{cwd\}/, '로그에 cwd 가 남아야 한다')
  assert.match(src, /--add-dir \$\{addDirs\.join/, '로그에 --add-dir 이 남아야 한다')
  /**
   * 🔴 «계산한 addDirs 를 넘기는가» 를 본다. 예전에는 `addDirs,\n` 이라는 **줄 모양**으로
   *   쌌는데, 같은 호출에 인자 하나(`exe:`)가 붙자 깨졌다(2026-09-30) — 계약은 그대로인데.
   *   호출을 집어 **무엇을 넘기는지**로 확인한다.
   */
  const call = /runClaude\(\{[\s\S]*?\}\)/.exec(src)?.[0] || ''
  assert.match(call, /\baddDirs\b/, 'runClaude 에 계산된 addDirs 를 넘겨야 한다')
  assert.ok(!/addDirs:\s*cfg\./.test(call), '설정값(cfg.addDirs)을 그대로 넘기면 안 된다')
})
