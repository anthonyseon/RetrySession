/**
 * usage-report.test.mjs — `/usage` 의 **글을 구조로** 옮기는 순수 함수와 그 길.
 *
 * 🔴 왜 실측 원문으로 시험하나
 *   이 글은 우리가 만든 것이 아니다. 서식이 언제든 바뀔 수 있고, 바뀌면 정규식은
 *   조용히 아무것도 못 뽑는다. 그때 화면이 «사용량 0» 이라 말하면 그게 최악의 거짓이다.
 *   그래서 ① 실측 원문으로 숫자를 뽑는 것을 고정하고 ② **못 뽑았을 때 원문을 남기는
 *   것**을 함께 고정한다. 둘째가 더 중요하다 — 첫째는 언젠가 깨지기 때문이다.
 *
 * 🔴 `usageReport()` 는 여기서 부르지 않는다 — CLI 를 실제로 띄운다(실측 2~8초).
 *   시험이 바깥 프로세스에 매달리면 그 프로세스가 느린 날 시험이 «실패» 로 보인다.
 *   조립은 화면 쪽에서 표본으로 그려 본다(`test/usage-panel.test.mjs`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseUsageText } from '../src/lib/usage.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

/** 실측 원문 (2026-09-28, `claude -p /usage --output-format json` 의 result) */
const REAL = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  "What's contributing to your limits usage?",
  'Approximate, based on local sessions on this machine — does not include other devices or claude.ai.'
  + ' Behaviors are independent characteristics, not a breakdown.',
  '',
  'Last 24h · 1,924 requests · 5 sessions',
  '  98% of your usage was at >150k context',
  '  87% of your usage came from sessions active for 8+ hours',
  '  Top skills: /tests-manual-sync 1%, /tests-verify 1%',
  '',
  'Last 7d · 3,769 requests · 6 sessions',
  '  97% of your usage was at >150k context',
  '  Top skills: /tests-writing 1%',
].join('\n')

test('실측 원문에서 창·요청 수·세션 수를 뽑는다 (쉼표가 든 숫자도)', () => {
  const u = parseUsageText(REAL)
  assert.equal(u.windows.length, 2, '24시간·7일 두 창이 나와야 한다')
  assert.deepEqual(
    u.windows.map((w) => [w.label, w.requests, w.sessions]),
    [['Last 24h', 1924, 5], ['Last 7d', 3769, 6]],
    '`1,924` 를 1924 로 읽어야 한다 — 쉼표를 안 지우면 NaN 이 된다')
})

test('성질과 스킬을 창마다 갈라 담는다 (창을 넘어가 섞이면 거짓이 된다)', () => {
  const [day, week] = parseUsageText(REAL).windows
  assert.deepEqual(day.traits.map((t) => t.percent), [98, 87])
  assert.match(day.traits[0].what, />150k context/, '원문을 그대로 들고 있어야 한다')
  assert.deepEqual(day.skills, ['/tests-manual-sync 1%', '/tests-verify 1%'])
  assert.deepEqual(week.traits.map((t) => t.percent), [97], '7일 창에 24시간 것이 섞이면 안 된다')
  assert.deepEqual(week.skills, ['/tests-writing 1%'])
})

test('🔴 그쪽이 붙인 한정 조건을 그대로 들고 온다 (근사값 · 구독)', () => {
  const u = parseUsageText(REAL)
  assert.equal(u.approximate, true, '«Approximate» 를 놓치면 근사가 실측처럼 보인다')
  assert.equal(u.subscription, true, '구독으로 도는지는 금액을 읽는 방식을 바꾼다')
})

test('🔴 원문을 언제나 함께 돌려준다 (파싱이 깨진 날 사람이 읽을 유일한 자리)', () => {
  for (const raw of [REAL, '무언가 새 서식', '']) {
    assert.equal(parseUsageText(raw).raw, raw, '원문을 버리면 서식이 바뀐 날 아무것도 안 남는다')
  }
})

test('🔴 형식이 달라도 던지지 않는다 — 못 읽은 것은 빈 목록으로 답한다', () => {
  for (const bad of [undefined, null, '', 'Last 24h', 'Last 24h · requests · sessions', 42, {}]) {
    const u = parseUsageText(bad)
    assert.deepEqual(u.windows, [], `${JSON.stringify(bad)} 에서 창을 지어내면 안 된다`)
    assert.equal(typeof u.raw, 'string', '원문은 언제나 문자열이어야 한다')
  }
})

test('빈 줄이 창을 닫는다 (다음 창의 성질이 앞 창에 붙지 않는다)', () => {
  const u = parseUsageText('Last 24h · 1 requests · 1 sessions\n\n  99% of stray line\n')
  assert.equal(u.windows.length, 1)
  assert.deepEqual(u.windows[0].traits, [], '빈 줄 뒤의 줄은 그 창의 것이 아니다')
})

/* ── 길: CLI → 서버 → 화면 ──────────────────────────────────── */

/**
 * 🔴 실측 (2026-09-28): 이 라우트를 먼저 넣고 **import 를 빠뜨렸다.**
 *   구문은 멀쩡하므로 `node --check` 도 시험도 잡지 못했고, 브라우저에서 눌렀을 때만
 *   500 이 났을 것이다. 라우트와 그 라우트가 부르는 이름은 함께 봐야 한다.
 */
test('🔴 /api/usage 라우트가 있고 usageReport 를 정말 가져온다', () => {
  const server = read('src', 'ui', 'server.mjs')
  assert.match(server, /import \{ usageReport \} from '\.\.\/lib\/usage\.mjs'/,
    '가져오지 않으면 누를 때 500 이 난다 — 구문 검사로는 안 잡힌다')
  assert.match(server, /p === '\/api\/usage'/, '라우트가 있어야 한다')
  const i = server.indexOf("p === '/api/usage'")
  const block = server.slice(i, i + 300)
  assert.match(block, /fresh/, '`갱신` 이 서버 캐시를 건너뛸 수 있어야 한다')
  assert.match(block, /usageReport\(/, '조립은 lib 이 한다 — 라우트에서 다시 짜지 않는다')
})

/**
 * 🔴 상태 조회와 **따로** 둔다. `/usage` 는 CLI 를 띄워 몇 초 걸리는데,
 *   3초마다 도는 `/api/status` 에 끼우면 화면 전체가 그만큼 느려진다.
 *   실측으로 이미 겪었다 — `/api/tray` 를 만든 이유가 같은 종류의 느림이었다.
 */
test('🔴 사용량은 상태 응답에 섞지 않는다 (폴링이 CLI 를 기다리게 된다)', () => {
  const status = read('src', 'lib', 'status.mjs')
  assert.ok(!status.includes('claudeUsage'), '/api/status 가 /usage 를 기다리면 화면이 멈춘 듯 보인다')
  assert.ok(!status.includes('usageReport'), '상태와 사용량은 다른 주기로 읽는다')
  const app = read('src', 'ui', 'app.js')
  assert.ok(!/pollLoop\([^)]*[Uu]sage/.test(app), '사용량을 폴링에 넣지 마라 — 사람이 볼 때만 읽는다')
})

test('`/usage` 는 슬래시 명령으로 부른다 (CLI 에 usage 하위 명령이 없다)', () => {
  const cli = read('src', 'lib', 'cli.mjs')
  const i = cli.indexOf('export function claudeUsage')
  assert.ok(i > 0, 'claudeUsage 가 있어야 한다')
  const body = cli.slice(i, i + 500)
  assert.match(body, /'-p', '\/usage'/, '`claude usage` 는 없다 — 슬래시 명령을 헤드리스로 부른다')
  assert.match(body, /--output-format', 'json'/, 'json 으로 받아야 result 를 꺼낼 수 있다')
  assert.match(body, /text/, '원문을 그대로 넘겨야 한다')
})

/**
 * 🔴 화면이 «오늘»과 «누적»을 갈라 보여주는 것은 사용자 지시다(2026-09-28):
 *   «사용량(토큰 포함)은 오늘(로컬 시간 기준), 누적으로 분리하여 표시한다.»
 *   그리고 오늘은 언제나 누적 이하다 — 그 불변식은 `test/usage-today.test.mjs` 가 센다.
 */
test('보고서가 오늘·누적을 갈라 담는다 (로컬 자정 기준을 함께 적는다)', () => {
  const lib = read('src', 'lib', 'usage.mjs')
  assert.match(lib, /dayKey\(\)/, '오늘은 **로컬** 자정 기준이다 (UTC 로 자르면 9시간 어긋난다)')
  assert.match(lib, /today:/, '오늘 몫을 담아야 한다')
  assert.match(lib, /total:/, '누적을 담아야 한다')
  assert.match(lib, /costNote/, '구독이면 정가 환산이 청구액이 아니라고 말해야 한다')
})
