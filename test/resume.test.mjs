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
const 코드 = SRC.split('\n')
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//') && !t.startsWith('*/') })
  .join('\n')

test('🔴 실행 중 판정을 직접 하지 않고 guard 의 것을 쓴다 (판정은 한 곳이다)', () => {
  assert.ok(코드.includes('sessionRunning'), 'resume.mjs 가 sessionRunning 판정을 써야 한다')
})

test('🔴 목록의 sessions 만 꺼내 쓰지 않는다 — ok 를 보지 않으면 조회 실패가 관문을 연다', () => {
  // 실측 결함: `new Map(run.sessions.map(...))` 로 맵만 만들고 ok 는 버렸다.
  // 조회가 실패하면 sessions 가 빈 배열이라 전부 "안 돌고 있다"가 됐다.
  assert.ok(!/new Map\(\s*run\.sessions/.test(코드),
    'runningSessions() 의 ok 를 버리고 sessions 만 쓰면 fail-open 이다')
  assert.ok(/firstRead\.ok/.test(코드), '첫 조회의 ok 를 확인해야 한다')
})

test('🔴 첫 조회가 실패하면 아무것도 밀지 않고 끝낸다', () => {
  const i = 코드.indexOf('firstRead.ok')
  assert.ok(i > 0)
  const section = 코드.slice(i, i + 700)
  assert.ok(section.includes('process.exit(0)'),
    '조회 실패 시 그대로 끝내야 한다 — 그냥 진행하면 사람이 쓰는 세션을 민다')
  assert.ok(section.includes('로그('), '왜 건너뛰었는지 기록해야 한다 — 조용히 멈추면 감시가 아니다')
})

test('🔴 한 대상을 민 뒤에는 목록을 다시 읽는다 (한 회차가 최대 30분이다)', () => {
  // 실측 결함: 두 맵을 루프 밖에서 한 번만 만들었다. 앞 세션을 30분 미는 동안
  // 사람이 다음 세션을 열어도 알 수 없었다.
  const loopBody = 코드.slice(코드.indexOf('for (const 대상 of 목록)'))
  assert.ok(loopBody.includes('readAt'), '루프 안에서 목록의 나이를 봐야 한다')
  assert.ok(/ctx\.실행중\s*=\s*readRunning\(\)/.test(loopBody), '루프 안에서 실행 중 목록을 다시 읽어야 한다')
  assert.ok(/ctx\.sessionMap\s*=/.test(loopBody), '세션 스캔(활성분 판정의 근거)도 함께 갱신해야 한다')
})

test('다시 읽을 때 캐시를 쓰지 않는다 — 캐시된 값이면 다시 읽는 의미가 없다', () => {
  assert.ok(/runningSessions\(\{\s*ttlMs:\s*0\s*\}\)/.test(코드),
    '판정용 조회는 ttlMs 0 이어야 한다')
})

test('🔴 실행 중 확인은 --force 로도 건너뛰지 않는다', () => {
  const i = 코드.indexOf('sessionRunning')
  const before = 코드.slice(Math.max(0, i - 400), i)
  // 바로 앞에 FORCE 분기가 열려 있으면 --force 로 뚫린다
  assert.ok(!/if \(!FORCE\) \{\s*$/.test(before.trimEnd()),
    '실행 중 확인이 !FORCE 블록 안에 들어가면 안 된다')
})

test('세션 id 형태가 아닌 등록 항목은 건너뛰되, 나머지 대상은 계속 돈다', () => {
  assert.ok(코드.includes('isSessionId'), 'resume.mjs 가 세션 id 형태를 확인해야 한다')
  // 대상 목록을 만드는 곳에서 걸러야 한다 — 그래야 나머지 대상은 그대로 돈다
  const 시작 = 코드.indexOf('function pickTargets()')
  assert.ok(시작 > 0, 'pickTargets() 을 찾을 수 없다')
  const body = 코드.slice(시작, 코드.indexOf('\n}', 시작))
  assert.ok(body.includes('isSessionId'), '대상 목록을 만들 때 형태를 걸러야 한다')
  assert.ok(/console\.warn/.test(body), '조용히 버리면 왜 안 도는지 알 수 없다')
})

test('🔴 setInterval·--loop 이 없다 (9시간 중단의 원인이었다)', () => {
  assert.ok(!/setInterval/.test(코드), 'resume.mjs 에 장수 타이머를 넣지 마라')
  assert.ok(!/--loop/.test(코드), 'resume.mjs 에 --loop 을 넣지 마라')
})
