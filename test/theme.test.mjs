/**
 * theme.test.mjs — **두 테마 모두** 기능이 갈리고 글자가 읽히는가를 숫자로 지킨다.
 *
 * 🔴 왜 (사용자 보고, 2026-09-28)
 *   "'어둡게' 를 적용한 UI 에서 기능의 구분이 어렵다." 재어 보니 그럴 만했고,
 *   이어서 밝은 쪽도 재 보니 같은 문제였다:
 *     어둡게 — 머리줄 vs 패널 ΔL* 4.0 · 경계선 vs 머리줄 4.7
 *     밝게   — 패널 vs 바닥   ΔL* 1.1 · 머리줄 vs 패널   3.8
 *   면들이 거의 같은 밝기여서 어디가 어느 영역인지 갈리지 않았다.
 *
 * 🔴 CIE L* 로 잰다. WCAG 대비율은 **어두운 쪽에서 체감과 어긋난다** — 예전 어두운
 *   테마의 비율은 밝은 테마와 거의 같았는데(1.09 vs 1.10) 눈에는 뭉개져 보였다.
 *   L* 는 지각적으로 균일해서 같은 ΔL* 가 어디서나 같은 정도로 보인다.
 *
 * 🔴 이 파일의 일은 "조금 예쁘게" 고치다 단계가 다시 좁아지거나 글자가 안 읽히게
 *   되는 것을 막는 것이다. 눈으로 보고 "괜찮네" 하면 반드시 되돌아온다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(join(ROOT, 'src', 'ui', 'theme.css'), 'utf8')
const app = readFileSync(join(ROOT, 'src', 'ui', 'app.css'), 'utf8')

/* ── 색 계산 (의존성 없이) ──────────────────────────────────── */
const rgb = (h) => { const n = h.replace('#', ''); const s = n.length === 3 ? [...n].map((c) => c + c).join('') : n; return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) }
const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const Y = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
/** CIE L* — 지각적으로 균일한 밝기 */
const L = (h) => { const y = Y(h); return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y }
const dL = (a, b) => Math.abs(L(a) - L(b))
const ratio = (a, b) => { const [x, y] = [Y(a), Y(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

/** theme.css 에서 `--이름:#rrggbb` 를 읽는다 */
function token(name) {
  const m = new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{3,6})\\b`, 'i').exec(css)
  assert.ok(m, `theme.css 에 --${name} 이 없다`)
  return m[1].toLowerCase()
}
/** 밝은 테마는 이름 그대로, 어두운 테마는 --d- 접두 */
const pal = (prefix) => {
  const t = (n) => token(prefix + n)
  return {
    plane: t('plane'), surface: t('surface'), hover: t('surface-hover'), chip: t('surface-2'),
    grid: t('grid'), base: t('base'),
    ink: t('ink'), ink2: t('ink-2'), muted: t('muted'),
    accent: t('accent'), accentSolid: t('accent-solid'),
    goodInk: t('good-ink'), critInk: t('crit-ink'),
  }
}
const THEMES = { 밝게: pal(''), 어둡게: pal('d-') }

/* ── 1. 인접한 면이 갈린다 ───────────────────────────────────── */

/**
 * 기준 ΔL* 6 — 실측에서 왔다. 4.0 일 때 사람이 "구분이 어렵다"고 했고 6.7 에서 갈렸다.
 * 여유를 크게 주면 "너무 튀지 않게"를 어긴다.
 *
 * 🔴 머리줄은 5.5 로 조금 낮다. 밝은 테마에서 패널이 흰색에 붙어 있어(L*98.9) 위로
 *   더 밀 수 없고, 머리줄을 더 내리면 바닥과 구별이 사라진다. 대신 머리줄 **아래
 *   경계선**이 8.9 로 받쳐 준다 — 면 하나가 아니라 면+선으로 갈린다.
 */
const STEP = { '패널 vs 바닥': 6, '머리줄 vs 패널': 5.5, '경계선 vs 패널': 6, '경계선 vs 머리줄': 6 }
const PAIR = {
  '패널 vs 바닥': ['surface', 'plane'], '머리줄 vs 패널': ['chip', 'surface'],
  '경계선 vs 패널': ['grid', 'surface'], '경계선 vs 머리줄': ['grid', 'chip'],
}

for (const [theme, p] of Object.entries(THEMES)) {
  for (const [name, [a, b]] of Object.entries(PAIR)) {
    test(`🔴 ${theme}: ${name} 가 갈린다 (ΔL* ≥ ${STEP[name]})`, () => {
      const d = dL(p[a], p[b])
      assert.ok(d >= STEP[name],
        `${d.toFixed(1)} 로 뭉개진다 (${p[a]} L*${L(p[a]).toFixed(1)} / ${p[b]} L*${L(p[b]).toFixed(1)})`)
    })
  }

  test(`${theme}: 층이 한 방향이다 (섞이면 어느 것이 위인지 모른다)`, () => {
    const up = theme === '어둡게'
      ? ['plane', 'surface', 'hover', 'chip', 'grid', 'base']   // 어두운 바닥에서 밝아진다
      : ['grid', 'plane', 'chip', 'hover', 'surface']           // 밝은 테마는 패널이 가장 밝다
    for (let i = 1; i < up.length; i++) {
      assert.ok(L(p[up[i]]) > L(p[up[i - 1]]),
        `${up[i - 1]}(L*${L(p[up[i - 1]]).toFixed(1)}) → ${up[i]}(L*${L(p[up[i]]).toFixed(1)}) 에서 순서가 뒤집혔다`)
    }
  })

  /**
   * 🔴 줄에 마우스를 올린 것은 **영역 경계가 아니라 스쳐 가는 표시**다. 6 을 요구하면
   *   목록이 번쩍인다. 2.5 만 있으면 손이 어디 있는지 알 수 있고, 고른 줄은 그 위에
   *   왼쪽 선까지 갖는다.
   */
  test(`${theme}: 올린 줄은 있는지 알 정도만 (ΔL* 2.5~5)`, () => {
    for (const [a, b, what] of [['hover', 'surface', '패널→올린 줄'], ['chip', 'hover', '올린 줄→고른 줄']]) {
      const d = dL(p[a], p[b])
      assert.ok(d >= 2.5, `${what} 이 ΔL* ${d.toFixed(1)} — 마우스가 어디 있는지 모른다`)
      assert.ok(d <= 5, `${what} 이 ΔL* ${d.toFixed(1)} — 스쳐 가는 표시가 너무 튄다`)
    }
  })

  test(`${theme}: 테마의 성격을 지킨다 (밝은 것이 어두워지거나 그 반대가 되지 않게)`, () => {
    if (theme === '어둡게') {
      assert.ok(L(p.plane) <= 6, `바닥이 L*${L(p.plane).toFixed(1)} — 어두운 테마가 아니게 된다`)
      assert.ok(L(p.base) <= 40, `가장 밝은 면이 L*${L(p.base).toFixed(1)} — 회색 화면이 된다`)
    } else {
      assert.ok(L(p.surface) >= 96, `패널이 L*${L(p.surface).toFixed(1)} — 밝은 테마가 아니게 된다`)
      assert.ok(L(p.plane) >= 85, `바닥이 L*${L(p.plane).toFixed(1)} — 너무 어둡다`)
    }
  })

  /* ── 2. 그 면 위에서 글자가 읽힌다 ────────────────────────── */

  /**
   * 🔴 면을 밝히면(또는 어둡히면) 그 위의 글자 대비는 떨어진다. 영역을 갈라 놓고
   *   글자를 못 읽게 만들면 바꾼 뜻이 없다. 배지·단추·머리줄은 --surface-2 위에
   *   앉으므로 **가장 불리한 그 면**에서 재야 한다.
   */
  for (const [what, key] of [['본문 ink', 'ink'], ['보조 ink-2', 'ink2'], ['흐린 muted', 'muted'],
    ['정상 good-ink', 'goodInk'], ['끊김 crit-ink', 'critInk']]) {
    test(`🔴 ${theme}: ${what} 이 칩 위에서 읽힌다 (4.5:1)`, () => {
      const r = ratio(p[key], p.chip)
      assert.ok(r >= 4.5, `${p[key]} on ${p.chip} = ${r.toFixed(2)}:1 — 작은 글씨라 4.5 를 넘어야 한다`)
    })
  }

  test(`${theme}: accent 는 도형이라 3:1 이면 된다 (글자로 쓰지 않는다)`, () => {
    assert.ok(ratio(p.accent, p.chip) >= 3, `accent ${p.accent} on ${p.chip} = ${ratio(p.accent, p.chip).toFixed(2)}:1`)
  })

  test(`🔴 ${theme}: primary 단추의 흰 글자가 읽힌다`, () => {
    const r = ratio('#ffffff', p.accentSolid)
    assert.ok(r >= 4.5, `#fff on ${p.accentSolid} = ${r.toFixed(2)}:1 — 가장 많이 누르는 단추의 라벨이다`)
    // 같은 파랑으로 보여야 한다 — 단추만 다른 색이면 그것이 더 튄다
    assert.ok(dL(p.accentSolid, p.accent) <= 8,
      `단추 채움이 accent 와 ΔL* ${dL(p.accentSolid, p.accent).toFixed(1)} 만큼 달라 다른 색으로 보인다`)
  })

  test(`${theme}: 단추 hover 테두리가 단추면에서 보인다`, () => {
    assert.ok(dL(p.base, p.chip) >= 6, `base ${p.base} vs 단추면 ${p.chip} ΔL* ${dL(p.base, p.chip).toFixed(1)}`)
  })
}

/* ── 3. 색만으로 뜻을 나르지 않는다 ─────────────────────────── */

test('🔴 crit 은 글자용과 아이콘용을 나눠 쓴다 (짙은 빨강은 글자로 안 읽힌다)', () => {
  assert.match(app, /\.badge\.crit\{color:var\(--crit-ink\)\}/, '글자는 --crit-ink')
  assert.match(app, /\.badge\.crit \.ic\{color:var\(--crit\)\}/, '아이콘은 짙은 --crit')
  // 실측: --crit #d03b3b 은 어두운 칩 위에서 2.91:1 로 AA 에 한참 못 미친다
  assert.ok(ratio(token('crit'), THEMES.어둡게.chip) < 4.5, '이 시험의 전제가 바뀌었다 — 다시 재라')
})

test('🔴 고른 줄은 색 말고 **선**으로도 말한다', () => {
  assert.match(app, /\.srow:hover\{background:var\(--surface-hover\)\}/)
  assert.match(app, /\.srow\.sel\{background:var\(--surface-2\); box-shadow:inset 3px 0 0 var\(--accent\)\}/,
    '색만으로 뜻을 나르지 않는다 — 고른 줄에는 왼쪽 선이 있어야 한다')
})

/* ── 4. 값이 두 벌이 아니다 ─────────────────────────────────── */

const darkBlocks = () => [...css.matchAll(
  /(?::root\[data-theme="dark"\]|:root:where\(:not\(\[data-theme="light"\]\)\))\s*\{([\s\S]*?)\n\s*\}/g)]

test('🔴 어두운 색 값은 한 곳에만 있다 (블록마다 다시 적지 않는다)', () => {
  const b = darkBlocks()
  assert.equal(b.length, 2, '어두운 테마를 켜는 블록은 둘이다 (토글 · 시스템 설정)')
  for (const m of b) {
    assert.ok(!/:\s*#[0-9a-f]{3,8}/i.test(m[1]),
      `블록에 색 값이 박혀 있다 — 값은 --d-* 한 곳에 두고 var() 로 연결한다:\n${m[1].trim()}`)
  }
})

test('🔴 두 블록이 **같은 줄**을 쓴다 (한쪽만 고치면 들어온 길에 따라 화면이 갈린다)', () => {
  const b = darkBlocks()
  const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split(/[;\n]/)
    .map((x) => x.trim()).filter(Boolean).sort().join('\n')
  assert.equal(norm(b[0][1]), norm(b[1][1]))
})

test('🔴 두 테마가 같은 이름을 모두 갖는다 (한쪽에만 있으면 그 테마에서 색이 사라진다)', () => {
  const light = new Set([...css.matchAll(/^\s*--(?!d-)([\w-]+)\s*:/gm)].map((m) => m[1]))
  const dark = new Set([...css.matchAll(/^\s*--d-([\w-]+)\s*:/gm)].map((m) => m[1]))
  // 뜻 색(good·warn·serious·crit)과 계량기 바탕은 테마를 따르지 않는다 — 일부러 밝은 쪽에만 있다
  const fixed = new Set(['good', 'warn', 'serious', 'crit'])
  const missing = [...dark].filter((n) => !light.has(n))
  assert.deepEqual(missing, [], `어두운 쪽에만 있는 이름: ${missing.join(', ')}`)
  const onlyLight = [...light].filter((n) => !dark.has(n) && !fixed.has(n))
  assert.deepEqual(onlyLight, [], `밝은 쪽에만 있어 어두운 테마에서 그대로 남는 이름: ${onlyLight.join(', ')}`)
})

test('연결한 이름이 실제로 정의돼 있다 (var() 가 헛돌면 색이 사라진다)', () => {
  const used = [...css.matchAll(/var\(--(d-[\w-]+)\)/g)].map((m) => m[1])
  assert.ok(used.length >= 12, `연결이 너무 적다 (${used.length}개) — 검사가 헛돈다`)
  for (const n of new Set(used)) assert.match(css, new RegExp(`--${n}\\s*:`), `--${n} 을 쓰는데 정의가 없다`)
})

test('정의해 두고 아무도 쓰지 않는 색이 없다', () => {
  const defined = [...css.matchAll(/^\s*--([\w-]+)\s*:/gm)].map((m) => m[1])
  const all = css + app + readFileSync(join(ROOT, 'src', 'ui', 'fold.css'), 'utf8')
  const dead = defined.filter((n) => (all.match(new RegExp(`var\\(--${n}[,)]`, 'g')) || []).length === 0)
  assert.deepEqual(dead, [], `쓰지 않는 색이 있다 — 고쳐도 아무 일이 없다: ${dead.join(', ')}`)
})
