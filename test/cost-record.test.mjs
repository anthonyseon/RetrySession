/**
 * cost-record.test.mjs — **잘려 나간 회차도 비용을 남긴다.**
 *
 * 🔴 실측 결함 (2026-09-28)
 *   `--output-format json` 은 **끝에 한 번** 출력한다. 그래서 타임아웃으로 kill 하면
 *   비용·턴·요약이 통째로 사라지고 `RUN 끝 · timeout · 1801초 · $0 · 턴 ?` 로 기록됐다.
 *   그런데 그 세 회차가 그날 **가장 많이 태운** 회차였다 — 트랜스크립트를 같은 방법으로
 *   재면 성공 회차($15.90 로 기록된 것)의 1.5~3배다(도구 56·58·75회 · 캐시읽기
 *   56.7M·58.7M·102.4M). 90분과 그만큼의 토큰이 장부에 없었다.
 *
 *   장부에 없는 지출은 «안 썼다» 로 읽힌다. 그 숫자를 보고 상한을 정하면 반드시 틀린다.
 *   그래서 결과 JSON 이 없으면 **트랜스크립트의 누적 차이**로 잰다.
 *
 * 🔴 이 시험은 진입점(resume.mjs)이 그 절차를 정말 거치는지 본다. resume.mjs 는 최상위에서
 *   바로 도는 스크립트라 불러서 시험할 수 없다(불러오면 claude 를 띄운다) — resume.test.mjs
 *   와 같은 이유로 소스를 읽어 고정한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { recordRun, emptyState } from '../src/lib/guard.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(join(ROOT, 'src', 'resume.mjs'), 'utf8')
/** 주석을 뺀 코드만 — 설명에 적힌 말이 검사를 통과시키면 안 된다 */
const code = src.split('\n')
  .filter((l) => { const t = l.trim(); return t && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//') })
  .join('\n')

test('🔴 띄우기 전에 그 세션의 누적 비용을 집어 둔다 (시작점이 없으면 뺄 수 없다)', () => {
  const i = code.indexOf('const costBefore')
  assert.ok(i > 0, '회차 시작 전 누적 비용을 잡아야 한다')
  assert.ok(i < code.indexOf('await runClaude('), '띄우기 **전에** 잡아야 한다')
  assert.match(code.slice(i, i + 120), /ctx\.sessionMap/, '집계에서 읽어야 한다(같은 출처)')
})

test('🔴 결과 JSON 에 비용이 없으면 트랜스크립트 차이로 잰다', () => {
  const i = code.indexOf('let costUSD')
  assert.ok(i > 0, '비용을 고르는 자리가 있어야 한다')
  const block = code.slice(i, i + 400)
  assert.match(block, /if \(!\(costUSD > 0\)\)/, '값이 있으면 그것을 쓰고, 없을 때만 재야 한다')
  assert.match(block, /refreshCtx\(ctx\)/, '재기 전에 집계를 다시 읽어야 한다 — 방금 자란 부분이 필요하다')
  assert.match(block, /costBefore/, '차이를 내야 한다')
  assert.match(block, /costFrom = '트랜스크립트 실측'/, '어디서 얻은 값인지 남겨야 한다')
})

test('🔴 기록과 로그가 그 값을 쓴다 (재 놓고 안 쓰면 소용없다)', () => {
  assert.match(code, /recordRun\(prev, \{\s*result, summary: p\.summary, tookSec: r\.tookSec, costUSD, costFrom,/,
    '기록에 넘겨야 한다')
  assert.ok(!/costUSD: p\.costUSD/.test(code), '옛 경로가 남아 있으면 둘 중 어느 값인지 알 수 없다')
  assert.match(code, /\$\$\{costUSD\}\$\{costFrom \? ` \(\$\{costFrom\}\)` : ''\}/,
    '로그에 값과 출처를 함께 적어야 한다 — 섞인 값을 모르고 쓰는 것이 더 나쁘다')
})

/* ── 기록 쪽: 출처를 그대로 보관한다 ────────────────────────── */

test('costFrom 은 기록에 남는다 (나중에 그 숫자를 의심할 수 있어야 한다)', () => {
  const n = recordRun(emptyState(), {
    result: 'timeout', tookSec: 3600, costUSD: 42.5, costFrom: '트랜스크립트 실측',
  }, { failStreakMax: 3 }, new Date('2026-09-18T12:00:00').getTime())
  assert.equal(n.lastRun.costFrom, '트랜스크립트 실측')
  assert.equal(n.costByDay['2026-09-18'], 42.5, '하루 비용에 더해져야 한다 — 이것이 통계의 정본이다')
})

test('🔴 잘린 회차의 비용도 하루 합계에 들어간다 (그 합을 보고 상한을 정한다)', () => {
  const base = new Date('2026-09-18T12:00:00').getTime()
  const cfg = { failStreakMax: 3 }
  let s = recordRun(emptyState(), { result: 'ok', tookSec: 590, costUSD: 15.9 }, cfg, base)
  s = recordRun(s, { result: 'timeout', tookSec: 3600, costUSD: 30, costFrom: '트랜스크립트 실측' }, cfg, base)
  assert.equal(s.costByDay['2026-09-18'], 45.9)
  assert.equal(s.byDay['2026-09-18'], 2, '횟수도 둘이다 — 잘린 회차도 시도는 시도다')
})
