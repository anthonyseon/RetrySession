/**
 * theme.test.mjs — **어두운 테마에서 기능이 갈리는가**를 숫자로 지킨다.
 *
 * 🔴 왜 (사용자 보고, 2026-09-28)
 *   "'어둡게' 를 적용한 UI 에서 기능의 구분이 어렵다." 재어 보니 그럴 만했다:
 *     머리줄 vs 패널  ΔL* 4.0 · 경계선 vs 머리줄 4.7 · 패널 vs 바닥 5.6
 *   패널과 그 머리줄과 바닥이 모두 거의 같은 밝기여서 영역이 뭉개졌다.
 *
 * 🔴 CIE L* 로 잰다. WCAG 대비율은 **어두운 쪽에서 체감과 어긋난다** —
 *   예전 값의 비율은 밝은 테마와 비슷했는데(1.09 vs 1.10) 눈에는 뭉개져 보였다.
 *   L* 는 지각적으로 균일해서 같은 ΔL* 가 어디서나 같은 정도로 보인다.
 *
 * 🔴 색을 "조금 예쁘게" 고치다 단계가 다시 좁아지는 것을 막는 것이 이 파일의 일이다.
 *   눈으로 보고 "괜찮네" 하면 반드시 되돌아온다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(join(ROOT, 'src', 'ui', 'theme.css'), 'utf8')

/* ── 색 계산 (의존성 없이) ──────────────────────────────────── */
const rgb = (h) => { const n = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) }
const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const Y = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
/** CIE L* — 지각적으로 균일한 밝기 */
const L = (h) => { const y = Y(h); return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y }
const dL = (a, b) => Math.abs(L(a) - L(b))
const ratio = (a, b) => { const [x, y] = [Y(a), Y(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

/** `--d-plane:#0d0d0c;` 같은 선언을 읽는다 */
function token(name) {
  const m = new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{6})`, 'i').exec(css)
  assert.ok(m, `theme.css 에 --${name} 이 없다`)
  return m[1].toLowerCase()
}

const D = {
  plane: token('d-plane'), surface: token('d-surface'), surface2: token('d-surface-2'),
  hover: token('d-surface-hover'), grid: token('d-grid'), base: token('d-base'),
  muted: token('d-muted'), critInk: token('d-crit-ink'), goodInk: token('d-good-ink'),
  ink2: token('d-ink-2'),
}

/* ── 1. 인접한 면이 갈린다 ───────────────────────────────────── */

/**
 * 기준 ΔL* 6 — 이 값은 실측에서 왔다. 4.0 이었을 때 사람이 "구분이 어렵다"고 했고,
 * 6.7 로 올린 뒤 갈렸다. 여유를 크게 주면 "너무 튀지 않게"를 어긴다.
 */
const MIN_STEP = 6

for (const [name, a, b] of [
  ['패널 vs 바닥', 'surface', 'plane'],
  ['머리줄 vs 패널', 'surface2', 'surface'],
  ['경계선 vs 패널', 'grid', 'surface'],
  ['경계선 vs 머리줄', 'grid', 'surface2'],
]) {
  test(`🔴 어두운 테마: ${name} 가 갈린다 (ΔL* ≥ ${MIN_STEP})`, () => {
    const d = dL(D[a], D[b])
    assert.ok(d >= MIN_STEP,
      `${name} 이 ΔL* ${d.toFixed(1)} 로 뭉개진다 (${D[a]} L*${L(D[a]).toFixed(1)} / ${D[b]} L*${L(D[b]).toFixed(1)})`)
  })
}

test('🔴 단계가 오르내리지 않고 한 방향이다 (바닥 < 패널 < 머리줄 < 경계선 < base)', () => {
  const order = ['plane', 'surface', 'surface2', 'grid', 'base']
  for (let i = 1; i < order.length; i++) {
    assert.ok(L(D[order[i]]) > L(D[order[i - 1]]),
      `${order[i - 1]} → ${order[i]} 에서 순서가 뒤집혔다 — 층이 섞이면 어느 것이 위인지 알 수 없다`)
  }
})

test('너무 튀지도 않는다 (어두운 테마가 회색 화면이 되면 안 된다)', () => {
  assert.ok(L(D.base) <= 40, `가장 밝은 면이 L*${L(D.base).toFixed(1)} — 어두운 테마가 아니게 된다`)
  assert.ok(L(D.plane) <= 6, '바닥은 충분히 어두워야 한다')
})

/* ── 2. 그 면 위에서 글자가 읽힌다 ──────────────────────────── */

/**
 * 🔴 면을 밝히면 그 위의 글자 대비는 **떨어진다.** 영역을 갈라 놓고 글자를 못 읽게
 *   만들면 바꾼 뜻이 없다. 배지는 머리줄과 같은 색(--surface-2) 위에 앉으므로
 *   가장 불리한 그 면에서 재야 한다.
 */
const AA = 4.5

for (const [name, key] of [['보조글', 'ink2'], ['흐린글(배지 off)', 'muted'], ['감시 끊김(crit)', 'critInk'], ['정상(good)', 'goodInk']]) {
  test(`🔴 ${name} 이 칩 위에서 읽힌다 (${AA}:1)`, () => {
    const r = ratio(D[key], D.surface2)
    assert.ok(r >= AA,
      `${name}(${D[key]}) 가 칩(${D.surface2}) 위에서 ${r.toFixed(2)}:1 — 작은 글씨라 ${AA} 를 넘어야 한다`)
  })
}

test('🔴 crit 은 글자용과 아이콘용을 나눠 쓴다 (짙은 빨강은 글자로 안 읽힌다)', () => {
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.css'), 'utf8')
  assert.match(app, /\.badge\.crit\{color:var\(--crit-ink\)\}/, '글자는 --crit-ink 여야 한다')
  assert.match(app, /\.badge\.crit \.ic\{color:var\(--crit\)\}/, '아이콘은 짙은 --crit 그대로')
  // 실측: --crit #d03b3b 은 칩 위에서 2.91:1 로 AA 에 한참 못 미친다
  assert.ok(ratio('#d03b3b', D.surface2) < AA, '이 시험의 전제가 바뀌었다 — 다시 재라')
})

/* ── 3. 고른 줄과 마우스를 올린 줄이 다르다 ─────────────────── */

test('🔴 마우스를 올린 줄과 **고른 줄**이 같은 색이 아니다', () => {
  assert.notEqual(D.hover, D.surface2,
    '둘이 같으면 어느 줄이 골라진 것인지 알 수 없다 (예전에는 둘 다 --surface-2 였다)')
  assert.ok(L(D.hover) > L(D.surface) && L(D.hover) < L(D.surface2),
    '올린 줄은 패널보다 밝고 고른 줄보다 어두워야 한다 — 고른 것이 더 도드라져야 한다')
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.css'), 'utf8')
  assert.match(app, /\.srow:hover\{background:var\(--surface-hover\)\}/)
  assert.match(app, /\.srow\.sel\{background:var\(--surface-2\); box-shadow:inset 3px 0 0 var\(--accent\)\}/,
    '고른 줄은 색 말고 **선**으로도 말해야 한다 — 색만으로 뜻을 나르지 않는다')
})

/* ── 4. 어두운 값이 두 벌이 아니다 ──────────────────────────── */

/**
 * 🔴 예전에는 `[data-theme="dark"]` 와 `prefers-color-scheme` 블록에 팔레트가 **두 벌**
 *   있었다. 한쪽만 고치면 토글로 들어온 사람과 시스템 설정으로 들어온 사람이 서로 다른
 *   화면을 보는데 아무도 경고하지 않는다. 이 저장소가 반복해서 다친 부류다.
 */
test('🔴 어두운 색 값은 한 곳에만 있다 (블록마다 다시 적지 않는다)', () => {
  const blocks = [...css.matchAll(/(?::root\[data-theme="dark"\]|:root:where\(:not\(\[data-theme="light"\]\)\))\s*\{([\s\S]*?)\n\s*\}/g)]
  assert.equal(blocks.length, 2, '어두운 테마를 켜는 블록은 둘이다 (토글 · 시스템 설정)')
  for (const b of blocks) {
    assert.ok(!/:\s*#[0-9a-f]{3,8}/i.test(b[1]),
      `블록 안에 색 값이 박혀 있다 — 값은 --d-* 한 곳에 두고 여기서는 var() 로 연결한다:\n${b[1].trim()}`)
  }
})

test('🔴 두 블록이 **같은 줄**을 쓴다 (한쪽만 고치면 화면이 갈린다)', () => {
  const blocks = [...css.matchAll(/(?::root\[data-theme="dark"\]|:root:where\(:not\(\[data-theme="light"\]\)\))\s*\{([\s\S]*?)\n\s*\}/g)]
  const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split(/[;\n]/)
    .map((x) => x.trim()).filter(Boolean).sort().join('\n')
  assert.equal(norm(blocks[0][1]), norm(blocks[1][1]),
    '토글용과 시스템용이 다른 것을 연결한다 — 들어온 길에 따라 다른 화면을 보게 된다')
})

test('연결한 이름이 실제로 정의돼 있다 (var() 가 헛돌면 색이 사라진다)', () => {
  const used = [...css.matchAll(/var\(--(d-[\w-]+)\)/g)].map((m) => m[1])
  assert.ok(used.length >= 10, `연결이 너무 적다 (${used.length}개) — 검사가 헛돈다`)
  for (const n of new Set(used)) {
    assert.match(css, new RegExp(`--${n}\\s*:`), `--${n} 을 쓰는데 정의가 없다`)
  }
})

test('정의해 두고 아무도 쓰지 않는 어두운 값이 없다', () => {
  const defined = [...css.matchAll(/^\s*--(d-[\w-]+)\s*:/gm)].map((m) => m[1])
  const used = new Set([...css.matchAll(/var\(--(d-[\w-]+)\)/g)].map((m) => m[1]))
  const dead = defined.filter((n) => !used.has(n))
  assert.deepEqual(dead, [], `쓰지 않는 어두운 색 값이 있다 — 고쳐도 아무 일이 없다: ${dead.join(', ')}`)
})
