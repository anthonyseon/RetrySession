/**
 * line-limit.test.mjs — **400줄 규칙을 저장소 전체에** 적용한다.
 *
 * 🔴 왜 새로 만들었나 (실측 2026-09-28)
 *   규칙은 CLAUDE.md 에 있는데 기계는 `src/ui/` 만 재고 있었다(ui-modules.test.mjs).
 *   그래서 이번 한 회차에 **세 번** 몰래 넘겼다 — `guard.mjs` 424줄 · `sessions.mjs` 423줄 ·
 *   `README.md` 두 번. 셋 다 임시로 만든 손 스크립트로 겨우 알아챘다.
 *   규칙을 지키는 일을 사람 눈에 맡기면 사람은 놓친다. 넘긴 자리는 **쪼개라는 신호**이고,
 *   신호가 안 오면 파일은 계속 자란다(app.js 는 781줄까지 자란 적이 있다).
 *
 * 🔴 세는 방법을 ui-modules.test.mjs 와 **같게** 맞춘다(`split('\n').length`).
 *   두 검사기가 다른 방법으로 세면 한쪽만 통과하는 줄 수가 생겨 규칙이 흐려진다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LIMIT = 400

/** 우리가 쓴 것만 본다 — 남의 것(node_modules)과 런타임 기록(state)은 규칙 밖이다 */
const SKIP_DIR = new Set(['node_modules', 'state', '.git', 'graphify-out'])
const COUNTED = /\.(mjs|js|css|html|md|ps1|cs|json)$/

/** 단가표·설정처럼 **데이터**인 파일은 쪼갤 대상이 아니다 (줄 수가 곧 내용이다) */
const DATA = /(^|\/)(config|package(-lock)?\.json)/

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) walk(join(dir, e.name), out)
    } else if (COUNTED.test(e.name)) out.push(join(dir, e.name))
  }
  return out
}

test('🔴 저장소의 모든 소스·문서가 400줄 규칙 안에 있다', () => {
  const over = []
  for (const p of walk(ROOT)) {
    const rel = '/' + p.slice(ROOT.length).replace(/\\/g, '/').replace(/^\/+/, '')
    if (DATA.test(rel)) continue
    const n = readFileSync(p, 'utf8').split('\n').length
    if (n > LIMIT) over.push(`${rel} — ${n}줄`)
  }
  assert.deepEqual(over, [],
    `400줄을 넘었다. 단일 책임으로 쪼개라 (넘긴 자리가 쪼갤 자리다):\n  ${over.join('\n  ')}`)
})

test('검사기가 헛돌지 않는다 (재는 파일이 실제로 있다)', () => {
  const files = walk(ROOT).map((p) => '/' + p.slice(ROOT.length).replace(/\\/g, '/').replace(/^\/+/, ''))
  assert.ok(files.length >= 80, `잰 파일이 ${files.length}개뿐이다 — 걷기가 멈춘 것이다`)
  for (const must of ['/README.md', '/CLAUDE.md', '/src/lib/guard.mjs', '/src/ui/app.js']) {
    assert.ok(files.includes(must), `${must} 를 재지 않고 있다`)
  }
})

test('규칙과 한계값이 CLAUDE.md 에 적힌 것과 같다', () => {
  // 시험이 규칙보다 느슨해지면 규칙이 없는 것과 같다
  assert.match(readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8'), /400줄/)
  assert.equal(LIMIT, 400)
})
