/**
 * naming.test.mjs — 이름 규칙을 **시험이 지킨다.**
 *
 * 규칙 (CLAUDE.md 2-2): **코드의 한글은 설명에만.** 이름은 영어로.
 *
 * 🔴 왜 문서가 아니라 시험인가
 *   666종 · 5,700여 회를 바꿔 놓고 규칙을 문서에만 적어 두면, 다음에 한 줄 더할 때
 *   조용히 되돌아온다. 이 저장소는 그 부류로 이미 여러 번 다쳤다(.ps1 의 한글,
 *   runhidden 을 안 거친 작업 하나). 사람 손을 믿지 않는다.
 *
 * 🔴 여기서 잡는 두 번째 것: **가림(shadowing)**
 *   실측 결함 (2026-09-22): 이름을 바꾸다 app.js 안에 `meta` 가 둘이 됐다 —
 *   함수 하나와 그릇 하나. 안쪽이 바깥을 가려 동작줄 단추 여섯 개가 전부
 *   `TypeError: meta is not a function` 으로 죽었다. 이름을 한꺼번에 바꿀 때
 *   **서로 다른 것이 같은 이름이 되는 일**은 드물지 않다. 구문은 멀쩡하므로
 *   node --check 도, 눈도 못 잡는다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** src 아래 모든 자바스크립트 (저장소 밖·산출물은 보지 않는다) */
function sources(dir = join(ROOT, 'src'), out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) sources(p, out)
    else if (/\.(mjs|js)$/.test(f)) out.push(p)
  }
  return out
}
const files = sources()
const rel = (p) => p.slice(ROOT.length).replace(/\\/g, '/')

/* ── 주석·문자열·정규식을 지운 사본 ──────────────────────────── */

/** 정규식이 올 수 있는 자리인가 — `a / b` 의 나눗셈과 `/re/` 를 가른다 */
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await', 'new', 'delete', 'void', 'throw'])
const regexAllowed = (prevChar, prevWord) =>
  prevChar === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prevChar) || REGEX_WORDS.has(prevWord)

/**
 * 설명(주석)과 사람에게 보일 글(문자열)을 **공백으로** 지운다. 줄 수와 자리는 지킨다.
 *
 * 🔴 단순 치환으로는 절대 안 된다 — 그렇게 했다가 설명 문장 24곳을 망가뜨렸다
 *   (`'조용히'` 를 바꾸면서 주석의 “조용히”까지 함께 바뀌었다).
 *   템플릿 문자열 안의 `${…}` 는 **코드다** — 쌓아서 구분한다.
 */
function stripNonCode(src) {
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  let out = '', i = 0, prevChar = '', prevWord = ''
  const ctx = []                                  // 'tpl' = 템플릿 안 · 'expr' = 그 안의 ${}
  const n = src.length
  while (i < n) {
    const c = src[i], d = src[i + 1] || ''
    if (ctx[ctx.length - 1] === 'tpl') {
      if (c === '\\') { out += '  '; i += 2; continue }
      if (c === '$' && d === '{') { ctx.push('expr'); out += '  '; i += 2; continue }
      if (c === '`') { ctx.pop(); out += ' '; i++; prevChar = '`'; continue }
      out += c === '\n' ? '\n' : ' '; i++; continue
    }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; out += blank(src.slice(i, end)); i = end; continue }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; out += blank(src.slice(i, end)); i = end; continue }
    if (c === "'" || c === '"') {
      const q = c, start = i; i++
      while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++ }
      i++
      out += blank(src.slice(start, Math.min(i, n))); prevChar = 'x'; prevWord = ''
      continue
    }
    if (c === '`') { ctx.push('tpl'); out += ' '; i++; continue }
    if (c === '}' && ctx[ctx.length - 1] === 'expr') { ctx.pop(); out += ' '; i++; prevChar = 'x'; continue }
    if (c === '/' && regexAllowed(prevChar, prevWord)) {
      const start = i; i++
      let inClass = false
      while (i < n) {
        const ch = src[i]
        if (ch === '\\') { i += 2; continue }
        if (ch === '\n') break
        if (ch === '[') inClass = true
        else if (ch === ']') inClass = false
        else if (ch === '/' && !inClass) break
        i++
      }
      i++
      while (i < n && /[a-z]/.test(src[i])) i++
      out += blank(src.slice(start, Math.min(i, n))); prevChar = 'x'; prevWord = ''
      continue
    }
    /**
     * 🔴 이름은 **통째로** 먹는다. 한 글자씩 보면 `return` 이 `eturn`·`turn`… 으로
     *   줄어들어 앞말 판정이 무너지고, `x / y` 의 나눗셈을 정규식으로 읽는다
     *   (자기 시험이 실제로 이것을 잡았다).
     */
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++
      prevWord = src.slice(i, j); prevChar = 'a'
      out += src.slice(i, j); i = j; continue
    }
    if (!/\s/.test(c)) { prevChar = c; prevWord = '' }
    out += c; i++
  }
  return out
}

/* ── 1. 코드에 한글이 없다 ───────────────────────────────────── */

test('🔴 코드의 한글은 설명에만 — 주석·문자열을 뺀 자리에는 한글이 없다', () => {
  const found = []
  for (const p of files) {
    const lines = stripNonCode(readFileSync(p, 'utf8')).split(/\r?\n/)
    lines.forEach((l, i) => {
      const m = l.match(/[가-힣ㄱ-ㅎㅏ-ㅣ]+/)
      if (m) found.push(`${rel(p)}:${i + 1}  «${m[0]}»  ${l.trim().slice(0, 70)}`)
    })
  }
  assert.deepEqual(found, [],
    `코드 자리(이름·키)에 한글이 남았다. 설명에만 쓴다:\n  ${found.join('\n  ')}`)
})

test('🔴 지우개가 멀쩡한지 스스로 확인한다 (헛돌면 위 시험이 조용히 통과한다)', () => {
  // 설명·문자열은 지우고, 이름은 남긴다
  const kept = stripNonCode([
    '// 여기는 설명이다',
    '/* 여기도 설명 */',
    "const a = '한글 값'",
    'const b = `템플릿 ${cc} 안`',
    "const re = /[가-힣]+/g",
    'const d = x / y / z',
  ].join('\n'))
  assert.ok(!/[가-힣]/.test(kept), `지워야 할 한글이 남았다:\n${kept}`)
  for (const name of ['const a', 'const b', 'cc', 'const re', 'const d', 'x', 'y', 'z']) {
    assert.ok(kept.includes(name), `지우면 안 되는 이름이 사라졌다: ${name}\n${kept}`)
  }
  // 한글 이름은 반드시 남아야 한다 — 이것이 남지 않으면 위 시험은 의미가 없다
  assert.match(stripNonCode('const 이름 = 1'), /이름/)
})

test('설명 글자 수는 그대로다 — 지우개가 줄을 먹지 않는다', () => {
  for (const p of files) {
    const src = readFileSync(p, 'utf8')
    assert.equal(stripNonCode(src).split('\n').length, src.split('\n').length, `${rel(p)} 의 줄 수가 달라졌다`)
  }
})

/* ── 2. 바깥 이름을 안쪽에서 가리지 않는다 ───────────────────── */

test('🔴 최상단 이름을 안쪽에서 다시 선언하지 않는다 (가리면 바깥 것이 사라진다)', () => {
  const found = []
  for (const p of files) {
    const lines = stripNonCode(readFileSync(p, 'utf8')).split(/\r?\n/)
    const top = new Map(), inner = new Map()
    lines.forEach((l, i) => {
      let m
      if ((m = l.match(/^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/))) {
        if (!top.has(m[1])) top.set(m[1], i + 1)
        return
      }
      if ((m = l.match(/^\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/))) {
        (inner.get(m[1]) || inner.set(m[1], []).get(m[1])).push(i + 1)
      }
    })
    for (const [name, at] of inner) {
      if (!top.has(name)) continue
      // 바깥 것이 **뒤에** 선언됐으면 가리는 일이 없다 (서로 다른 구역이다)
      if (top.get(name) > at[at.length - 1]) continue
      found.push(`${rel(p)}  «${name}»  최상단 ${top.get(name)}줄 ← 안쪽 ${at.join(', ')}줄`)
    }
  }
  assert.deepEqual(found, [],
    `안쪽 선언이 최상단 이름을 가린다 — 그 구역에서 바깥 것을 부르면 터진다:\n  ${found.join('\n  ')}`)
})

/* ── 3. 설명이 없는 이름을 가리키지 않는다 ───────────────────── */

test('🔴 @param 이 가리키는 이름도 영어다 (이름을 바꾸고 설명만 남으면 거짓말이 된다)', () => {
  const found = []
  for (const p of files) {
    readFileSync(p, 'utf8').split(/\r?\n/).forEach((l, i) => {
      const m = l.match(/@param\s+(?:\{[^}]*\}\s*)?([^\s]+)/)
      if (m && /[가-힣]/.test(m[1])) found.push(`${rel(p)}:${i + 1}  «${m[1]}»`)
    })
  }
  assert.deepEqual(found, [], `@param 이름이 한글이다 — 실제 매개변수와 맞지 않는다:\n  ${found.join('\n  ')}`)
})
