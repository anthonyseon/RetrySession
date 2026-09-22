/**
 * skills.test.mjs — 이 저장소의 Claude 스킬이 거짓말하지 않게 한다.
 *
 * 왜 시험하나
 *   스킬은 "이렇게 하라"고 지시하는 문서다. 거기 적힌 스크립트나 npm 명령이 실제로
 *   없으면, 읽는 쪽은 그대로 따라 하다 막히고 **문서를 불신하게 된다.**
 *   틀린 안내는 없느니만 못하다. 파일 이름과 명령이 실재하는지 기계가 확인한다.
 *
 * 스킬은 RetrySession 안에만 둔다(.claude/skills/). 이 저장소에만 적용되는 절차다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const skillDir = join(ROOT, '.claude', 'skills')

function skills() {
  if (!existsSync(skillDir)) return []
  return readdirSync(skillDir)
    .filter((d) => statSync(join(skillDir, d)).isDirectory())
    .map((d) => ({ name: d, path: join(skillDir, d, 'SKILL.md') }))
}

/** `---` 로 둘러싼 YAML 머리말에서 key: value 를 뽑는다 (의존성 없이) */
function frontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src)
  if (!m) return null
  const out = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i < 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

test('스킬이 최소 하나는 있다', () => {
  assert.ok(skills().length >= 1, '.claude/skills/ 에 스킬이 있어야 한다')
})

test('모든 스킬에 SKILL.md 와 머리말이 있다', () => {
  for (const s of skills()) {
    assert.ok(existsSync(s.path), `${s.name}: SKILL.md 가 없다`)
    const fm = frontmatter(readFileSync(s.path, 'utf8'))
    assert.ok(fm, `${s.name}: --- 로 둘러싼 머리말이 없다`)
    assert.ok(fm.name, `${s.name}: name 이 없다`)
    assert.ok(fm.description, `${s.name}: description 이 없다`)
  }
})

test('🔴 name 이 폴더 이름과 같다 — 다르면 호출되지 않는다', () => {
  for (const s of skills()) {
    const fm = frontmatter(readFileSync(s.path, 'utf8'))
    assert.equal(fm.name, s.name, `${s.name}: 폴더 이름과 name 이 다르다`)
  }
})

test('description 이 "언제 쓰는지"를 말한다 — 이것으로 호출 여부가 갈린다', () => {
  for (const s of skills()) {
    const fm = frontmatter(readFileSync(s.path, 'utf8'))
    assert.ok(fm.description.length >= 40,
      `${s.name}: description 이 너무 짧다(${fm.description.length}자). 어떤 상황에서 쓰는지 적어야 한다`)
    assert.match(fm.description, /사용한다|쓸 때|쓰는|때의/,
      `${s.name}: description 에 "언제 쓰는지"가 없다`)
  }
})

test('🔴 스킬이 가리키는 .ps1 이 실재한다', () => {
  for (const s of skills()) {
    const src = readFileSync(s.path, 'utf8')
    const ref = new Set()
    for (const m of src.matchAll(/(?:\.\\|\\)?((?:scripts\\)?[A-Za-z0-9._-]+\.ps1)/g)) {
      ref.add(m[1].replace(/\\/g, '/'))
    }
    for (const rel of ref) {
      const candidates = [join(ROOT, rel), join(ROOT, 'scripts', rel.split('/').pop())]
      assert.ok(candidates.some((p) => existsSync(p)),
        `${s.name}: '${rel}' 를 안내하는데 그런 파일이 없다`)
    }
  }
})

test('🔴 스킬이 가리키는 npm 명령이 실재한다', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  for (const s of skills()) {
    const src = readFileSync(s.path, 'utf8')
    for (const m of src.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
      assert.ok(pkg.scripts?.[m[1]],
        `${s.name}: 'npm run ${m[1]}' 를 안내하는데 package.json 에 없다`)
    }
    if (/\bnpm test\b/.test(src)) assert.ok(pkg.scripts?.test, 'npm test 가 package.json 에 없다')
  }
})

test('🔴 스킬이 가리키는 start.exe 스위치가 실재한다', () => {
  const start = readFileSync(join(ROOT, 'start.ps1'), 'utf8')
  for (const s of skills()) {
    const src = readFileSync(s.path, 'utf8')
    for (const m of src.matchAll(/start\.(?:exe|ps1)\s+(-[A-Za-z]+)/g)) {
      assert.ok(start.includes(m[1]),
        `${s.name}: 'start ${m[1]}' 를 안내하는데 start.ps1 에 그 스위치가 없다`)
    }
  }
})

test('스킬이 CLAUDE.md 를 대체하지 않는다 — 불변 규칙은 거기가 정본이다', () => {
  const change = skills().find((s) => s.name === 'retrysession-change')
  if (!change) return
  assert.match(readFileSync(change.path, 'utf8'), /CLAUDE\.md/,
    '변경 절차 스킬은 불변 규칙의 정본(CLAUDE.md)을 가리켜야 한다')
})
