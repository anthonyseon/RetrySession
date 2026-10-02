/**
 * config.test.mjs — **설정이 거짓말을 하지 않는가.**
 *
 * 🔴 왜 이 시험이 필요한가 (실측 결함, 2026-09-22)
 *   `config/projects.json` 은 `resume.enabled` 를 기본 false 로 두고 저장소마다
 *   켜는 모양을 하고 있었다. 그런데 **아무도 그 값을 읽지 않았다.** 끄둔 줄 알고
 *   자리를 비우면 무인 재개가 돌고 돈이 나간다. 같은 파일에 읽지 않는 `주기분`
 *   키가 둘 더 있었다 — 5를 10으로 고쳐도 감시 주기는 그대로다(주기의 정본은
 *   OS 예약 트리거다). `config/ui-labels.json` 에는 풍선 알림을 걷어낸 뒤에도
 *   `alert.*` 문구 8개가 남아, 알림이 살아 있는 것처럼 보였다.
 *
 *   **고쳐도 아무 일이 없는 설정은 없느니만 못하다.** 사람은 고쳤다고 믿는다.
 *   그래서 여기서는 "설정에 적힌 것을 코드가 정말 읽는가"를 기계로 확인한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const conf = (f) => JSON.parse(readFileSync(join(ROOT, 'config', f), 'utf8'))

/** 코드 전부 (src · scripts · start.ps1) — 설정을 읽는 자리는 이 안에 있다 */
const codeText = (() => {
  const parts = []
  const rec = (d) => {
    for (const f of readdirSync(d)) {
      if (['node_modules', '.git', 'state'].includes(f)) continue
      const p = join(d, f)
      if (statSync(p).isDirectory()) rec(p)
      else if (/\.(mjs|js|ps1)$/.test(f)) parts.push(readFileSync(p, 'utf8'))
    }
  }
  rec(join(ROOT, 'src')); rec(join(ROOT, 'scripts'))
  parts.push(readFileSync(join(ROOT, 'start.ps1'), 'utf8'))
  return parts.join('\n')
})()

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 이 키를 코드가 읽는가 — `.키` · `['키']` · `"키"` 어느 모양이든 */
const isRead = (key) => new RegExp(`[.\\['"\`]${escape(key)}\\b`).test(codeText)

/** `_` 로 시작하는 것은 사람 읽으라고 둔 주석이다 — 코드가 안 읽는 게 정상 */
function knobs(o, out = new Set()) {
  if (Array.isArray(o)) o.forEach((v) => knobs(v, out))
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_')) continue
      out.add(k); knobs(v, out)
    }
  }
  return out
}

/* ── 1. 고쳐도 아무 일 없는 설정이 없다 ──────────────────────── */

for (const file of ['projects.json', 'ui-labels.json']) {
  test(`🔴 ${file} 의 모든 키를 코드가 읽는다 (읽지 않는 설정은 거짓말이다)`, () => {
    const dead = [...knobs(conf(file))].filter((k) => !isRead(k)).sort()
    assert.deepEqual(dead, [],
      `${file} 에 아무도 읽지 않는 키가 있다 — 고쳐도 아무 일이 없는데 사람은 바뀐 줄 안다:\n  ${dead.join(', ')}`)
  })
}

test('🔴 읽지 않는 키를 넣으면 잡는다 (검사기가 헛돌지 않는다)', () => {
  const fake = { defaults: { resume: { 어디에도없는설정: 1 } } }
  const dead = [...knobs(fake)].filter((k) => !isRead(k))
  assert.deepEqual(dead, ['어디에도없는설정'])
})

/* ── 2. 설정 키도 영어다 (CLAUDE.md 2-2) ─────────────────────── */

test('🔴 설정 파일의 키에 한글이 없다 (값은 한글이어도 된다)', () => {
  const found = []
  const walk = (o, at, file) => {
    if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${at}[${i}]`, file))
    else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (/[가-힣]/.test(k)) found.push(`${file}: ${at}.${k}`)
        walk(v, `${at}.${k}`, file)
      }
    }
  }
  for (const f of readdirSync(join(ROOT, 'config')).filter((f) => f.endsWith('.json'))) {
    walk(conf(f), '', f)
  }
  assert.deepEqual(found, [], `설정 키에 한글이 남았다:\n  ${found.join('\n  ')}`)
})

/* ── 3. 자율 재개의 저장소 단위 잠금 ─────────────────────────── */

test('🔴 자율 재개는 기본으로 꺼져 있다 (모르고 켜지는 일이 없어야 한다)', () => {
  assert.equal(conf('projects.json').defaults.resume.enabled, false,
    '새 저장소가 기본으로 무인 실행되면 안 된다 — 돈이 나가고 파일이 바뀐다')
})

test('🔴 resume.enabled 를 판정이 실제로 읽는다 (이게 없어서 스위치가 죽어 있었다)', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'resume-gate.mjs'), 'utf8')
  assert.match(src, /cfg\.enabled === false/, '저장소 단위 잠금을 보지 않는다')
  // 정말 막는지는 test/resume-gate.test.mjs 가 **불러서** 확인한다
})

test('🔴 --force 로도 저장소 잠금을 못 뚫는다', () => {
  const src = readFileSync(join(ROOT, 'src', 'lib', 'resume-gate.mjs'), 'utf8')
  const at = src.indexOf('cfg.enabled === false')
  // 바로 앞의 `if (!FORCE) {` 블록 안에 들어 있으면 --force 가 건너뛴다
  const before = src.slice(Math.max(0, at - 400), at)
  assert.ok(!/if \(!FORCE\) \{[^}]*$/.test(before),
    '저장소 잠금이 --force 로 뚫린다 — 실행 중 확인·사용량 제한과 같은 층이어야 한다')
})

/* ── 4. 트레이 문구는 양쪽이 맞아야 한다 ─────────────────────── */

/**
 * 🔴 tray.ps1 은 ASCII 라서 문구를 이 JSON 에서 읽는다. 한쪽만 고치면
 *   트레이가 조용히 **영어 기본값**으로 떨어진다(Lbl 은 실패해도 fallback 을
 *   돌려준다 — 감시 장치가 멈추지 않게 하려는 것이므로 그 설계는 옳다).
 *   그래서 어긋남은 시험이 잡아야 한다.
 */
const labelPaths = () => {
  const out = new Set()
  for (const f of readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.ps1'))) {
    const s = readFileSync(join(ROOT, 'scripts', f), 'utf8')
    for (const m of s.matchAll(/Lbl\s+'([^']+)'/g)) out.add(m[1])
  }
  return [...out].sort()
}

test('🔴 트레이가 부르는 문구가 설정에 전부 있다', () => {
  const labels = conf('ui-labels.json')
  const missing = labelPaths().filter((p) => p.split('.').reduce((o, k) => (o ?? {})[k], labels) === undefined)
  assert.deepEqual(missing, [], `tray.ps1 이 부르는데 ui-labels.json 에 없다 — 영어 기본값으로 떨어진다:\n  ${missing.join(', ')}`)
})

test('🔴 설정에만 있고 아무도 안 부르는 문구가 없다 (걷어낸 기능의 잔해)', () => {
  const asked = new Set(labelPaths())
  const leaves = []
  const walk = (o, at) => {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_')) continue
      const path = at ? `${at}.${k}` : k
      if (v && typeof v === 'object') walk(v, path)
      else leaves.push(path)
    }
  }
  walk(conf('ui-labels.json'), '')
  const unused = leaves.filter((p) => !asked.has(p))
  assert.deepEqual(unused, [],
    `아무도 안 부르는 문구가 남아 있다 — 그 기능이 살아 있는 것처럼 보인다:\n  ${unused.join(', ')}`)
})

/* ── 값들끼리 앞뒤가 맞는가 ─────────────────────────────────── */

/**
 * 🔴 **락이 회차보다 먼저 낡으면 안 된다.**
 *
 *   `timeoutMin` 을 30 → 60 으로 올렸을 때(2026-09-29) `lockStaleMin` 은 60 이었다.
 *   그러면 60분째에 도는 회차의 락이 «낡았다» 로 회수되고 **두 번째 재개가 같은 세션에
 *   들어온다** — 두 회차가 같은 워킹트리를 고치면 서로의 편집을 덮어쓴다.
 *   한 값을 올리면 다른 값이 따라와야 하는 관계는 사람 기억이 아니라 시험이 지켜야 한다.
 */
test('🔴 lockStaleMin 은 timeoutMin 보다 크다 (도는 회차의 락을 회수하면 중복이 된다)', () => {
  const r = conf('projects.json').defaults.resume
  assert.ok(r.lockStaleMin > r.timeoutMin,
    `락 낡음 ${r.lockStaleMin}분 ≤ 회차 시간 ${r.timeoutMin}분 — 도는 회차의 락을 빼앗는다`)
})

/**
 * 🔴 프로세스 단일 실행의 낡음 한계도 한 회차보다 길어야 한다.
 *   짧으면 도는 재개를 «죽은 것» 으로 보고 두 번째 프로세스가 뜬다.
 */
test('🔴 재개 프로세스의 낡음 한계도 회차 시간보다 크다', () => {
  const r = conf('projects.json').defaults.resume
  const m = /singleInstance\('resume', \{ staleMin: (\d+) \}\)/.exec(
    readFileSync(join(ROOT, 'src', 'resume.mjs'), 'utf8'))
  assert.ok(m, 'singleInstance 호출을 못 찾았다')
  assert.ok(Number(m[1]) > r.timeoutMin, `단일 실행 낡음 ${m[1]}분 ≤ 회차 ${r.timeoutMin}분`)
})

test('🔴 판정·실행의 기본값이 설정과 같다 (설정을 못 읽었을 때도 같게 돌아야 한다)', () => {
  const r = conf('projects.json').defaults.resume
  const pairs = [
    ['src/lib/claude-run.mjs', /cfg\.timeoutMin \?\? (\d+)/, r.timeoutMin, 'timeoutMin'],
    ['src/lib/resume-gate.mjs', /cfg\.timeoutMin \?\? (\d+)/, r.timeoutMin, 'timeoutMin'],
    ['src/resume.mjs', /cfg\.lockStaleMin \?\? (\d+)/, r.lockStaleMin, 'lockStaleMin'],
  ]
  for (const [file, re, want, name] of pairs) {
    const m = re.exec(readFileSync(join(ROOT, ...file.split('/')), 'utf8'))
    assert.ok(m, `${file} 에서 ${name} 기본값을 못 찾았다`)
    assert.equal(Number(m[1]), want, `${file} 의 ${name} 기본값 ${m[1]} ≠ 설정 ${want}`)
  }
})
