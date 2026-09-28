/**
 * permission.test.mjs — 무인 재개가 **어떤 권한으로** 도는가.
 *
 * 🔴 사용자 결정 (2026-09-28): RetrySession 은 `claude --dangerously-skip-permissions` 와
 *   같은 권한으로 돈다. 그 뜻은 **무인 재개가 무엇이든 실행할 수 있다**는 것이다.
 *
 *   왜 올렸나 (실측) — `acceptEdits` 로 두 회차를 돌렸고 둘 다 결과가 없었다:
 *     13:48 · ok · $18.271 · 권한거부 11건 → 디스크 변경 0건 (Write·Edit·git·node)
 *     15:11 · ok · $15.814 · 권한거부  7건 → 디스크 변경 0건 (node 스크립트·리다이렉션)
 *   대상 저장소는 편집을 자기 `.mjs` 로만 하고 게이트 15종을 돌리도록 규약이 세워져 있어서,
 *   node 를 못 쓰면 일을 **시작할 수조차** 없다. 돈만 쓰고 끝났다.
 *
 * 🔴 그래서 이 시험은 두 가지를 함께 지킨다:
 *   ① 권한이 실제로 올라가 있는가(플래그가 붙는가)
 *   ② **남은 방어선이 그대로 있는가** — 권한을 올린 대신 그것들이 유일한 안전장치가 됐다.
 *      지시문의 안전 규칙 두 줄 · 하루 횟수 상한 · 회차 타임아웃 · "일하는 중" 판정.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const cfg = JSON.parse(read('config', 'projects.json'))

test('🔴 설정이 claude --dangerously-skip-permissions 와 같은 권한을 쓴다', () => {
  assert.equal(cfg.defaults.resume.permissionMode, 'bypassPermissions',
    '무인 재개의 권한 모드는 설정에 명시돼 있어야 한다')
})

test('🔴 bypassPermissions 면 --dangerously-skip-permissions 를 함께 넘긴다', () => {
  const run = read('src', 'lib', 'claude-run.mjs')
  assert.match(run, /--dangerously-skip-permissions/,
    '모드만 넘기면 헤드리스에서 승인 요청이 생겨 곧 거부된다(실측 권한거부 11·7건)')
  // 🔴 조건 없이 붙이면 모드를 내려도 권한이 안 내려간다 — 되돌릴 길을 막지 않는다
  assert.match(run, /=== 'bypassPermissions'\) args\.push\('--dangerously-skip-permissions'\)/,
    '그 모드일 때만 붙여야 한다 — 설정을 내리면 권한도 내려가야 한다')
})

test('🔴 권한을 올린 값이 실측 근거와 함께 기록돼 있다 (다음 사람이 되돌리지 않게)', () => {
  const note = cfg.defaults._resumeNotes.permissionMode
  assert.match(note, /dangerously-skip-permissions/, '무엇과 같은 권한인지 적어야 한다')
  assert.match(note, /2026-09-28/, '언제 누가 정했는지 적어야 한다')
  assert.match(note, /권한거부|디스크 변경 0건/, '왜 올렸는지 실측 근거를 적어야 한다')
  assert.match(note, /내리려면/, '되돌리는 길을 적어야 한다')
})

/* ── 남은 방어선 ─────────────────────────────────────────────── */

test('🔴 재개 지시문의 안전 규칙 두 줄이 그대로 있다 (권한을 올린 뒤 유일한 제동이다)', () => {
  const prompt = read('src', 'lib', 'prompt.mjs')
  assert.match(prompt, /판단이 갈리는 지점에서는 멈춘다|추측으로 진행하지 않는다/,
    '추측 금지 규칙이 있어야 한다')
  assert.match(prompt, /되돌리기 어려운/, '되돌리기 어려운 작업 금지 규칙이 있어야 한다')
  assert.match(prompt, /force push|브랜치 삭제/, '무엇이 그런 작업인지 예를 들어야 한다')
})

/**
 * 🔴 **승인이 없다는 것은 규약이 없다는 뜻이 아니다** (사용자 지시 2026-09-28).
 *   권한이 좁을 때는 CLI 가 막아 줬지만(권한거부 11·7건), 이제 막는 것이 없으므로
 *   **작업 저장소의 규약이 유일한 경계**다. 그 규약은 그 저장소 안에 적혀 있고
 *   (스킬·CLAUDE.md·README.md), 대개 실측 사고에서 온 것들이다 —
 *   지시문이 그것을 읽으라고 말하지 않으면 무인 실행은 규약 밖에서 일하게 된다.
 */
test('🔴 지시문이 작업 저장소의 규약을 먼저 읽으라고 말한다', () => {
  const prompt = read('src', 'lib', 'prompt.mjs')
  for (const where of ['.claude/skills', 'CLAUDE.md', 'README.md']) {
    assert.ok(prompt.includes(where), `규약이 어디 있는지 알려야 한다 — ${where} 가 없다`)
  }
  assert.match(prompt, /승인이 없다는 것은 규약이 없다는 뜻이 아니다/,
    '권한이 열렸다는 것과 규약이 사라졌다는 것을 구별해 말해야 한다')
  assert.match(prompt, /규약과 이 지시가 어긋나면/, '어긋날 때 무엇을 할지 말해야 한다(멈추고 적는다)')
})

test('🔴 그 규칙이 실제로 지시문에 실려 나간다 (함수에만 있으면 소용없다)', async () => {
  const { buildPrompt } = await import('../src/lib/prompt.mjs')
  const text = buildPrompt(
    { resumePrompt: '남은 항목을 진행한다', sessionId: 'x' },
    { id: 'P', repo: 'c:/r', resume: {} },
    { limitStopped: false, interrupted: false })
  assert.match(text, /\.claude\/skills/, '지시문 본문에 규약 위치가 있어야 한다')
  assert.match(text, /되돌리기 어려운/, '지시문 본문에 안전 규칙이 있어야 한다')
})

test('🔴 하루 횟수 상한과 회차 타임아웃이 살아 있다 (지출과 파급을 묶는 유일한 값)', () => {
  const r = cfg.defaults.resume
  assert.equal(typeof r.maxPerDay, 'number')
  assert.ok(r.maxPerDay > 0 && r.maxPerDay <= 24, `하루 횟수 상한이 이상하다: ${r.maxPerDay}`)
  assert.equal(typeof r.timeoutMin, 'number')
  assert.ok(r.timeoutMin > 0 && r.timeoutMin <= 60, `회차 타임아웃이 이상하다: ${r.timeoutMin}`)
  // 비용은 막지 않기로 했으므로(2026-09-28) 이 둘이 실제 제동이다
  const guard = read('src', 'lib', 'guard.mjs')
  assert.match(guard, /하루 상한 \$\{max\}회/, '횟수로 막는 분기가 있어야 한다')
})

test('🔴 새 저장소는 기본으로 꺼져 있다 (권한이 높을수록 이 기본값이 중요하다)', () => {
  assert.equal(cfg.defaults.resume.enabled, false,
    '기본이 켜져 있으면 모르는 저장소에서 무엇이든 실행하는 재개가 돈다')
})
