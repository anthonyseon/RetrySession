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
import { join, resolve } from 'node:path'
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

/**
 * 🔴 스킬이 가리키는 **소스·시험 파일**도 실재해야 한다.
 *
 *   실측 (2026-09-28): 이 회차에 스킬을 고치면서 `lib/resume-gate.mjs` ·
 *   `test/config.test.mjs` · `test/docs.test.mjs` 같은 **새 파일 이름**을 여럿 적었다.
 *   지금은 맞지만, 파일이 옮겨지거나 이름이 바뀌면 스킬만 조용히 뒤처진다.
 *   설명서에 이미 같은 규칙을 걸어 뒀다(test/docs.test.mjs) — 스킬도 같은 대접을 받는다.
 *
 *   `.ps1` 은 위에서 이미 검사한다. 여기서는 `src/**` 와 `test/**` 를 본다.
 */
test('🔴 스킬이 가리키는 src·test 파일이 실재한다', () => {
  const missing = []
  for (const s of skills()) {
    const src = readFileSync(s.path, 'utf8')
    for (const m of src.matchAll(/\b((?:src|test)\/[\w./-]*\.(?:mjs|js|json))/g)) {
      // `src/lib/x.mjs` 처럼 폴더를 줄여 쓴 것도 받아 준다 (lib/x.mjs → src/lib/x.mjs)
      if (!existsSync(join(ROOT, m[1]))) missing.push(`${s.name}: ${m[1]}`)
    }
    for (const m of src.matchAll(/\blib\/([\w-]+\.mjs)\b/g)) {
      if (!existsSync(join(ROOT, 'src', 'lib', m[1]))) missing.push(`${s.name}: lib/${m[1]}`)
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    `스킬이 없는 파일을 가리킨다 — 따라 하다 막히면 문서를 불신하게 된다:\n  ${missing.join('\n  ')}`)
})

test('🔴 스킬이 가리키는 config 파일이 실재한다', () => {
  const missing = []
  for (const s of skills()) {
    for (const m of readFileSync(s.path, 'utf8').matchAll(/\bconfig\/([\w-]+\.json)\b/g)) {
      if (!existsSync(join(ROOT, 'config', m[1]))) missing.push(`${s.name}: config/${m[1]}`)
    }
  }
  assert.deepEqual([...new Set(missing)], [], `없는 설정 파일을 가리킨다:\n  ${missing.join('\n  ')}`)
})

/**
 * 🔴 스킬이 적은 **뮤텍스 이름**이 실제 이름과 같아야 한다.
 *
 *   진단 스킬은 "트레이가 살아 있는지는 명령줄이 아니라 뮤텍스로 봐라"고 시키고,
 *   변경 스킬은 그 이름을 그대로 적어 준다(명령줄 매칭이 자기 자신을 세는 함정 때문).
 *   이름이 어긋나면 `TryOpenExisting` 은 조용히 `False` 를 돌려주고, 읽는 쪽은
 *   **살아 있는 트레이를 죽었다고** 판정한다 — 진단 도구가 거짓 음성을 내는 것이라
 *   없느니만 못하다. 이름은 `scripts/tray.ps1` 이 정본이다.
 */
test('🔴 스킬이 적은 트레이 뮤텍스 이름이 tray.ps1 의 것과 같다', () => {
  const tray = readFileSync(join(ROOT, 'scripts', 'tray.ps1'), 'utf8')
  const real = /New-Object\s+System\.Threading\.Mutex\([^,]+,\s*'([^']+)'/.exec(tray)
  assert.ok(real, 'tray.ps1 에서 뮤텍스 이름을 읽지 못했다 — 검사기가 헛돈다')
  for (const s of skills()) {
    for (const hit of readFileSync(s.path, 'utf8').matchAll(/Global\\[A-Za-z0-9._-]+/g)) {
      assert.equal(hit[0], real[1],
        `${s.name}: 스킬이 '${hit[0]}' 를 적었는데 tray.ps1 은 '${real[1]}' 다`)
    }
  }
})

/**
 * 🔴 스킬이 가리키는 **절 번호**도 실재해야 한다.
 *
 *   실측 (2026-09-28): 표에 `(§8)` · `(§9)` 라고 적었는데 그 스킬에는 7절까지만 있었다.
 *   파일 이름이 틀리면 따라 하다 막히지만, 절 번호가 틀리면 **찾다가 포기한다** —
 *   더 조용한 실패다. 파일·명령에 이미 같은 규칙을 걸어 뒀으니 절 번호도 같은 대접을 받는다.
 */
test('🔴 스킬이 가리키는 절 번호가 그 문서에 있다', () => {
  const missing = []
  for (const s of skills()) {
    const src = readFileSync(s.path, 'utf8')
    // 그 문서 안의 제목에서 번호를 모은다: `## 3. …` · `### 3-1. …`
    const heads = new Set([...src.matchAll(/^#{2,3}\s+([\d-]+)[.\s]/gm)].map((m) => m[1]))
    for (const m of src.matchAll(/§([\d-]+)/g)) {
      // 다른 문서(Manual 등)의 절을 가리키는 것은 여기서 판단하지 않는다
      const sameDoc = !/(Manual|README|CLAUDE)[^§]{0,20}§/.test(src.slice(Math.max(0, m.index - 40), m.index + 2))
      if (sameDoc && !heads.has(m[1])) missing.push(`${s.name}: §${m[1]}`)
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    `스킬이 없는 절을 가리킨다 — 읽는 사람은 찾다가 포기한다:\n  ${missing.join('\n  ')}`)
})

test('🔴 검사기가 헛돌지 않는다 (없는 파일을 넣으면 잡아야 한다)', () => {
  assert.equal(existsSync(join(ROOT, 'src', 'lib', 'nosuch-gate.mjs')), false)
  assert.equal(existsSync(join(ROOT, 'config', 'nosuch.json')), false)
})

/**
 * 🔴 스킬이 **곁 파일**을 가리키면 그 파일이 실재해야 한다.
 *
 *   실측 (2026-09-29): `retrysession-change/SKILL.md` 가 404줄이 되어(규칙 400) 창 함정
 *   세 항목을 `windows-traps.md` 로 갈랐다. 이렇게 쪼갤 때 링크를 잘못 적으면 읽는 쪽은
 *   «있다고 하는데 없는 문서» 를 찾게 되고, 그때부터 스킬 전체를 불신한다.
 *   같은 부류로 이미 다쳤다 — 없는 npm 명령을 적어 둔 적이 있다(위 시험이 그래서 있다).
 */
test('🔴 스킬이 가리키는 곁 파일이 실재한다 (쪼갤 때 링크가 깨진다)', () => {
  for (const s of skills()) {
    const dir = join(skillDir, s.name)
    /**
     * 🔴 곁 파일 **안의** 링크도 본다. 갈라낸 조각은 한 겹 깊어진 자리에서 저장소 문서를
     *   가리키므로(`../../../docs/…`) 옮기는 순간 깨지기 쉽다 — 실측(09-30)으로 두 번 갈랐다.
     */
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const src = readFileSync(join(dir, f), 'utf8')
      for (const m of src.matchAll(/\]\((\.{1,2}\/[^)\s]+\.md)\)/g)) {
        assert.ok(existsSync(resolve(dir, m[1])),
          `${s.name}/${f} 가 ${m[1]} 을 가리키는데 그 파일이 없다 — 읽는 쪽은 스킬을 불신한다`)
      }
    }
  }
})

test('🔴 갈라낸 곁 파일도 400줄 규칙 안에 있고, 본문이 그것을 가리킨다', () => {
  for (const s of skills()) {
    const dir = join(skillDir, s.name)
    const src = readFileSync(s.path, 'utf8')
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'SKILL.md')) {
      const n = readFileSync(join(dir, f), 'utf8').split('\n').length
      assert.ok(n <= 400, `${s.name}/${f} 가 ${n}줄이다 — 쪼갠 조각도 규칙 안이다`)
      assert.ok(src.includes(`./${f}`),
        `${s.name}/${f} 를 아무도 가리키지 않는다 — 읽히지 않는 절차는 없는 절차다`)
    }
  }
})
