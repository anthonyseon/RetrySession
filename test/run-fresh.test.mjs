/**
 * run-fresh.test.mjs — **재시작은 최신 정보로 판정한 뒤에만 띄운다.**
 *
 * 🔴 왜 (실측 2026-09-28)
 *   화면이 보여주는 판정은 **몇 초 전에 받은 것**이고, 자동갱신을 끄면 몇 분 전 것일 수도
 *   있다. 그 사이 사람이 그 세션에 입력하거나·도구가 끝나거나·제한이 풀린다.
 *   낡은 화면을 근거로 띄우면 사람이 쓰는 대화에 끼어들 수 있고, 반대로 화면에 "가능"으로
 *   보이던 것이 조용히 SKIP 되기도 한다 — 사용자가 실제로 겪은 것이 그 혼동이었다
 *   (화면은 켜져 있는데 로그에는 `SKIP · 할 일이 없다`).
 *
 *   그래서 `/api/run` 은 띄우기 전에 **같은 진입점**(`resume.mjs --dry-run`)으로 다시
 *   판정하고, 그 답을 응답에 담아 돌려준다. 판정을 여기서 다시 짜지 않는 이유는
 *   재료 조립이 세 곳이 되면 반드시 어긋나기 때문이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const actions = read('src', 'ui', 'actions.mjs')

test('🔴 재시작을 띄우기 전에 최신 판정을 다시 받는다', () => {
  assert.match(actions, /--dry-run/, '실행 직전에 dry-run 으로 다시 판정해야 한다')
  assert.match(actions, /execFileSync/, '판정은 기다려서 받아야 한다(비동기로 흘리면 못 쓴다)')
  // 판정을 여기서 다시 짜면 재료 조립이 세 곳이 된다 — 반드시 어긋난다
  assert.ok(!actions.includes('resumeGate'),
    '판정을 여기서 다시 짜면 안 된다 — 실제 실행과 같은 진입점에 물어본다')
})

test('🔴 막히는 판정이면 띄우지 않고 이유를 돌려준다', () => {
  const i = actions.indexOf('if (!v.go)')
  assert.ok(i > 0, '막히는 판정을 가려내는 분기가 있어야 한다')
  const block = actions.slice(i, i + 200)
  assert.match(block, /started: false/, '띄우지 않았다고 말해야 한다')
  assert.match(block, /verdict/, '왜 안 띄웠는지 함께 돌려줘야 한다')
})

test('🔴 판정을 못 받으면 띄우지 않는다 (모르는 채로 미는 것이 가장 나쁘다)', () => {
  const i = actions.indexOf('catch')
  const block = actions.slice(i, i + 260)
  assert.match(block, /go: false/, 'dry-run 이 실패하면 막아야 한다')
})

test('하트비트는 그대로 띄운다 (판정이 없다 — 기록만 남긴다)', () => {
  assert.match(actions, /kind === 'resume' && sessionId/, '재개+세션 지정일 때만 판정을 끼운다')
})

/**
 * 🔴 **화면의 '지금 재시작 실행' 은 `--now` 다** (사용자 결정 2026-09-28):
 *   «사용자의 의지로 실행하는 것이기 때문에 재시작 조건과 상관없이 강제로 재개지시를
 *   실행한다.» `--force` 보다 세다 — force 는 일하는 세션·제한 중을 지켰다.
 *   무엇을 건너뛰고 무엇은 못 건너뛰는지는 `test/resume-now.test.mjs` 가 못박는다.
 *
 * 🔴 판정과 실행이 **같은 플래그**여야 한다. 한쪽만 `--now` 면 화면은 "가능"이라 답하고
 *   실제 회차는 조건에 막혀 SKIP 된다(또는 그 반대) — 사용자가 겪은 혼동이 그것이었다.
 */
test('🔴 지금 재시작 실행은 판정과 실행 **둘 다** --now 로 부른다', () => {
  const probe = /--dry-run'[^\]]*\]/.exec(actions)
  assert.ok(probe, '실행 직전 판정(dry-run) 호출을 찾지 못했다')
  assert.match(probe[0], /'--now'/, '판정도 --now 로 물어야 한다 — 아니면 답과 실행이 갈린다')
  const spawn = /function spawnResume[\s\S]*?\)\n/.exec(actions)
  assert.ok(spawn, 'spawnResume 을 찾지 못했다')
  assert.match(spawn[0], /'--now'/, '실제 실행도 --now 여야 한다')
})

test('🔴 무엇을 건너뛰는지·무엇에 끼어드는지 **누르기 전에** 말한다', () => {
  assert.match(detail, /재시작 조건을 \*\*전부\*\* 건너뜁니다/, '조건을 전부 건너뛴다고 말해야 한다')
  assert.match(detail, /하루 횟수 · 최소 간격 · 연속실패 · 조용한 시간 · 사용량 제한을 건너뜁니다/,
    '무엇을 건너뛰는지 적어야 한다')
  assert.match(detail, /일하는 중이어도 끼어듭니다/,
    '🔴 다른 사람이 쓰는 세션에 끼어들 수 있다는 것을 누르기 전에 말해야 한다')
  assert.match(detail, /이미 재개가 돌고 있으면 띄우지 않습니다/,
    '락은 --now 로도 안 뚫린다 — 눌렀는데 안 돌면 고장으로 읽힌다')
})

/* ── 화면 쪽 ─────────────────────────────────────────────────── */

const detail = read('src', 'ui', 'detail.js')

test('🔴 화면이 보여준 판정과 최신 판정을 견주고, 다르면 말한다', () => {
  assert.match(detail, /restart\?\.gate/, '화면이 보여주던 판정을 집어야 비교할 수 있다')
  assert.match(detail, /verdict/, '응답의 최신 판정을 읽어야 한다')
  assert.match(detail, /화면이 보여주던 판정과 달랐습니다/, '다르면 다르다고 말해야 한다')
  assert.match(detail, /actions\.say\(/, '누른 결과를 동작줄에 적어야 한다')
})

test('🔴 누른 뒤에는 화면을 최신으로 맞춘다 (낡은 값을 그대로 두지 않는다)', () => {
  const i = detail.indexOf("kind: 'resume'")
  const after = detail.slice(i, i + 900)
  assert.match(after, /actions\.loadStatus\(\)/, '상태를 다시 읽어야 한다')
  assert.match(after, /actions\.loadDetail/, '상세도 다시 읽어야 한다')
})

test('두 번 눌리지 않게 단추를 잠근다 (한 번의 확인으로 두 번 띄우면 안 된다)', () => {
  const i = detail.indexOf("kind: 'resume'")
  const around = detail.slice(Math.max(0, i - 400), i + 200)
  assert.match(around, /disabled = true/, '보내는 동안 단추를 잠가야 한다')
  assert.match(around, /disabled = false/, '끝나면 풀어야 한다')
})
