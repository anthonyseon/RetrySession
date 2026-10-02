/**
 * resume.test.mjs — 자율 재개가 **사람이 쓰는 대화에 끼어들지 않는가.**
 *
 * 🔴 왜 소스를 읽어 검사하는가
 *   src/resume.mjs 는 최상위에서 바로 도는 진입점이라(가져오면 실제로 claude 를 띄운다)
 *   불러서 시험할 수 없다. 판정 자체는 guard.mjs 로 빼서 거기서 시험하고(세션실행중),
 *   여기서는 **진입점이 그 판정을 정말 거치는지, 그리고 낡은 목록으로 판정하지 않는지**를
 *   고정한다. 판정이 아무리 옳아도 부르지 않으면 소용이 없다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = readFileSync(join(ROOT, 'src', 'resume.mjs'), 'utf8')
/** 주석을 뺀 코드만 — 주석에 적힌 설명이 검사를 통과시키면 안 된다 */
const code = SRC.split('\n')
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//') && !t.startsWith('*/') })
  .join('\n')
test('🔴 판정을 직접 하지 않고 resume-gate 의 것을 쓴다 (판정은 한 곳이다)', () => {
  assert.ok(code.includes('resumeGate('), 'resume.mjs 가 판정 함수를 불러야 한다')
  // 판정을 여기서 다시 짜면 화면과 답이 갈린다 — 그 사고를 이미 겪었다
  assert.ok(!/openTools|lastKind/.test(code),
    '재개가 자기 나름대로 "쓰는 중"을 판정하면 안 된다 — 재료는 판정 함수에만 넘긴다')
})

/**
 * 🔴 **pid 를 판정에 쓰지 않는다** (2026-09-28 에 걷어냈다).
 *
 *   예전에는 `claude agents --json` 으로 실행 중인지 보고, 살아 있으면 무조건 막았다.
 *   그런데 "프로세스가 살아 있다"는 "사람이 그 세션을 쓰고 있다"가 아니다 — 창을 열어 둔
 *   채 다른 세션에서 일하는 것이 보통이다. 그 오해로 등록된 세션이 **560회 연속**
 *   `세션이 실행 중이다 (pid 4084)` 로 건너뛰어졌다(2026-09-22~09-28).
 *   게다가 그 조회는 자주 흔들리는데, 실패하면 회차를 통째로 버렸다.
 *
 *   지금은 그 세션의 **기록**이 답한다(미완결 도구·마지막 차례·조용한 시간).
 *   되살리지 마라 — 되살리면 이 도구는 다시 아무 일도 하지 않는다.
 */
test('🔴 pid 조회를 판정 경로에 되살리지 않았다', () => {
  for (const gone of ['runningSessions', 'sessionRunning', 'isAlive', 'firstRead']) {
    assert.ok(!code.includes(gone), `${gone} 가 판정 경로에 돌아왔다 — pid 는 "쓰는 중"을 말하지 못한다`)
  }
})

/**
 * 🔴 **최신 정보로 판정한다** — 두 자리에서.
 *   ① 대상마다 판정 직전(10초 이상 묵었으면 다시 읽는다)
 *   ② **락을 잡은 뒤, 띄우기 직전에 한 번 더** — 판정과 실행 사이에도 시간이 흐른다.
 *   ②가 없으면 "조용하다"가 이미 거짓이 된 뒤에 밀어 넣을 수 있다(사람이 막 입력한 순간).
 */
test('🔴 대상마다 판정 직전에 집계를 다시 읽는다 (한 회차가 최대 30분이다)', () => {
  const loopBody = code.slice(code.indexOf('for (const target of items)'))
  assert.match(loopBody, /refreshCtx\(ctx, 10_000\)/, '판정 전에 집계의 나이를 보고 다시 읽어야 한다')
  // 다시 읽는 일은 한 함수에 모았다 — 그 함수가 실제로 증분 스캔을 부르는지 본다
  const helper = code.slice(code.indexOf('function refreshCtx'))
  assert.match(helper.slice(0, 400), /scanSessions\(\)/, '다시 읽는 것은 증분 스캔이다')
  assert.match(helper.slice(0, 400), /ctx\.sessionMap\s*=/, '집계를 갈아끼워야 한다')
})

test('🔴 락을 잡은 뒤 띄우기 직전에 다시 판정한다 (판정과 실행 사이에도 시간이 흐른다)', () => {
  const i = code.indexOf('acquireLock(')
  assert.ok(i > 0)
  const afterLock = code.slice(i, code.indexOf('runClaude(', i))
  assert.match(afterLock, /refreshCtx\(ctx\)/, '락을 잡은 뒤 무조건 다시 읽어야 한다')
  assert.match(afterLock, /verdict\(target, ctx\)/, '같은 판정 함수로 다시 판정해야 한다')
  assert.match(afterLock, /if \(!again\.go\)/, '뒤집혔으면 띄우지 않아야 한다')
  assert.match(afterLock, /logSkip/, '왜 안 띄웠는지 기록해야 한다')
  // 지시문도 최신 판정으로 다시 만들어야 한다 — 지점이 바뀌었으면 옛 지시문은 거짓이다
  assert.match(afterLock, /buildPrompt\(target, again\.project/, '지시문을 최신 판정으로 다시 만들어야 한다')
})

test('🔴 "일하는 중" 확인은 --force 로도 건너뛰지 않는다', () => {
  const gate = readFileSync(join(ROOT, 'src', 'lib', 'resume-gate.mjs'), 'utf8')
  const i = gate.indexOf('GATE.busy')
  assert.ok(i > 0, '판정에 busy 관문이 있어야 한다')
  // busy 검사 앞에서 !force 블록이 열린 채로 남아 있으면 --force 로 뚫린다
  const before = gate.slice(0, i)
  assert.ok(before.lastIndexOf('if (!force) {') < before.lastIndexOf('\n  }'),
    'busy 검사가 !force 블록 안에 있다 — 일하는 세션은 force 로도 건드리지 않는다')
})

test('세션 id 형태가 아닌 등록 항목은 건너뛰되, 나머지 대상은 계속 돈다', () => {
  assert.ok(code.includes('isSessionId'), 'resume.mjs 가 세션 id 형태를 확인해야 한다')
  // 대상 목록을 만드는 곳에서 걸러야 한다 — 그래야 나머지 대상은 그대로 돈다
  const startedText = code.indexOf('function pickTargets()')
  assert.ok(startedText > 0, 'pickTargets() 을 찾을 수 없다')
  const body = code.slice(startedText, code.indexOf('\n}', startedText))
  assert.ok(body.includes('isSessionId'), '대상 목록을 만들 때 형태를 걸러야 한다')
  assert.ok(/console\.warn/.test(body), '조용히 버리면 왜 안 도는지 알 수 없다')
})

test('🔴 setInterval·--loop 이 없다 (9시간 중단의 원인이었다)', () => {
  assert.ok(!/setInterval/.test(code), 'resume.mjs 에 장수 타이머를 넣지 마라')
  assert.ok(!/--loop/.test(code), 'resume.mjs 에 --loop 을 넣지 마라')
})

/* ── --rearm 이 엉뚱한 것을 풀지 않는다 ──────────────────────── */

/**
 * 🔴 실측 결함 (2026-09-22): `--session <없는id>` 를 주면 고른 대상이 0개가 되고,
 *   그러면 **전부를 푸는 쪽으로 물러섰다.** 오타 하나로 다른 세션의 회로 차단까지
 *   풀린다. 차단은 "고칠 때까지 멈춰라"는 표시인데 그걸 조용히 지우는 셈이다.
 *   같은 부류를 HTTP 쪽에서 이미 고쳤다(없는 sessionId → 400).
 */
test('🔴 --session 으로 고른 것이 없으면 아무것도 풀지 않는다', async () => {
  const { doRearm } = await import('../src/lib/resume-report.mjs')
  const said = []
  const realErr = console.error
  console.error = (m) => said.push(String(m))
  try {
    const did = doRearm([], { picked: true })
    assert.equal(did, false, '아무것도 하지 않아야 한다')
    assert.ok(said.some((m) => /고른 대상이 없다/.test(m)), '왜 안 했는지 말해야 한다')
  } finally { console.error = realErr }
})

test('🔴 부르는 쪽이 --session 여부를 넘긴다 (안 넘기면 옛 동작으로 돌아간다)', () => {
  const src = readFileSync(join(ROOT, 'src', 'resume.mjs'), 'utf8')
  assert.match(src, /doRearm\(pickTargets\(\), \{ picked: !!opt\('--session'\) \}\)/,
    '--session 을 줬는지 알려주지 않으면 "못 골랐다"와 "전부"를 구별할 수 없다')
})
