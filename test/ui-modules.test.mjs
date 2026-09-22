/**
 * ui-modules.test.mjs — 화면 모듈들이 **실제로 맞물리는가.**
 *
 * 🔴 왜 이게 필요한가
 *   app.js 가 781줄까지 자라 조각으로 나눴다(규칙은 400줄). 그런데 조각으로
 *   나누면 새 실패 방식이 생긴다 — **import 한 이름이 그쪽에 없는 경우**다.
 *   브라우저는 그때 모듈 전체를 통째로 거부하고, 화면은 **아무것도 그려지지 않는다.**
 *   node --check 는 못 잡는다(구문은 멀쩡하다). 눈으로도 안 보인다.
 *   그래서 import 이름과 export 이름을 맞춰 본다.
 *
 *   또 하나: 조각이 쓰는 전역 이름이 어디에도 정의되지 않았을 때도 같은 일이 난다.
 *   실제로 나눌 때 `그리기()` · `상세읽기()` 같은 호출이 그대로 남아 있었다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { uiModules } from './_ui-files.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const UI = join(ROOT, 'src', 'ui')
/**
 * 🔴 목록을 손으로 적지 않는다.
 *   setup.js 를 새로 만들었을 때 이 파일의 목록에서 **빠뜨렸다** — 그래서 새 모듈이
 *   import 정합성·400줄 검사에서 통째로 빠졌다. 폴더에서 읽으면 그럴 수 없다.
 *   (같은 부류로 이미 여러 번 다쳤다: /api/ping 을 써야 하는 .ps1 네 개 중 세 개,
 *    runhidden.exe 를 거쳐야 하는 작업 네 개 중 하나.)
 */
const 모듈들 = uiModules()
/** app.js(진입점)를 뺀 조각들 */
const 조각들 = 모듈들.filter((f) => f !== 'app.js')
/** 그리는 조각들 — common.js 는 공용 도구라 그리지 않는다 */
const 그리는조각 = 조각들.filter((f) => f !== 'common.js')

const 읽기 = (f) => readFileSync(join(UI, f), 'utf8')

/** `import { a, b } from './x.js'` → [{ 경로, 이름들 }] */
function import들(src) {
  const out = []
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    out.push({
      이름들: m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean),
      경로: m[2],
    })
  }
  return out
}

/** `export { a, b }` 와 `export function a` / `export const a` 를 모은다 */
function export들(src) {
  const out = new Set()
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const x of m[1].split(',')) {
      const 이름 = x.trim().split(/\s+as\s+/).pop()
      if (이름) out.add(이름)
    }
  }
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([^\s(]+)/g)) out.add(m[1])
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([^\s=]+)/g)) out.add(m[1])
  return out
}

test('🔴 import 한 이름이 그쪽에 정말 export 되어 있다', () => {
  for (const f of 모듈들) {
    const src = 읽기(f)
    for (const { 이름들, 경로 } of import들(src)) {
      if (!경로.startsWith('.')) continue
      const 대상 = resolve(dirname(join(UI, f)), 경로)
      assert.ok(existsSync(대상), `${f} 가 없는 파일을 import 한다: ${경로}`)
      const 있는것 = export들(readFileSync(대상, 'utf8'))
      for (const 이름 of 이름들) {
        assert.ok(있는것.has(이름),
          `${f} 가 ${경로} 의 '${이름}' 을 가져오는데 그쪽은 export 하지 않는다 — ` +
          '브라우저가 모듈을 통째로 거부해 화면이 빈 채로 뜬다')
      }
    }
  }
})

test('🔴 export 한 것 중 아무도 안 쓰는 것이 없다 (죽은 코드)', () => {
  // 분리하면서 esc 같은 죽은 코드를 걷어냈다. 다시 쌓이지 않게 고정한다.
  const 쓰임 = 모듈들.map(읽기).join('\n')
  for (const f of 모듈들) {
    if (f === 'app.js') continue   // 진입점은 아무도 import 하지 않는다
    for (const 이름 of export들(읽기(f))) {
      // 자기 파일 밖에서 이름이 쓰이는지 본다 — 시험만 쓰는 export 도 인정한다
      const 남들 = 모듈들.filter((x) => x !== f).map(읽기).join('\n')
      const 시험 = readdirSync(join(ROOT, 'test'))
        .map((x) => readFileSync(join(ROOT, 'test', x), 'utf8')).join('\n')
      assert.ok(남들.includes(이름) || 시험.includes(이름),
        `${f} 가 '${이름}' 을 export 하는데 아무도 쓰지 않는다 — 지워라`)
    }
  }
  assert.ok(!/const esc =/.test(쓰임), '쓰지 않는 esc 를 되살리지 마라')
})

test('🔴 조각이 정의되지 않은 이름을 부르지 않는다 (나눌 때 실제로 남아 있었다)', () => {
  // app.js 에만 있는 함수들을 조각이 직접 부르면 브라우저에서 ReferenceError 다.
  const app만 = ['보내기', 'loadStatus', 'loadDetail', '그리기', 'updateFreshness', 'errorReason', 'applySummary', '메타']
  for (const f of 조각들) {
    const src = 읽기(f)
    const 코드 = src.split('\n')
      .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
      .join('\n')
    for (const 이름 of app만) {
      // `동작.이름` 은 허용된다 — 등록소를 거치는 것이 규칙이다
      const 직접 = new RegExp(`(^|[^.\\w가-힣])${이름}\\s*\\(`, 'g')
      const 남은 = [...코드.matchAll(직접)].filter((m) => !/function\s*$/.test(코드.slice(0, m.index)))
      assert.equal(남은.length, 0,
        `${f} 가 '${이름}()' 을 직접 부른다 — common.js 의 동작 등록소를 거쳐야 한다`)
    }
  }
})

test('의존 방향이 한 쪽이다 — app -> 조각 -> common', () => {
  // common 은 아무것도 import 하지 않는다(가장 아래다)
  assert.equal(import들(읽기('common.js')).filter((x) => x.경로.startsWith('.')).length, 0,
    'common.js 가 다른 조각을 import 하면 순환의 시작이다')

  // 조각들은 common 만 import 한다
  for (const f of 그리는조각) {
    for (const { 경로 } of import들(읽기(f))) {
      if (!경로.startsWith('.')) continue
      assert.equal(경로, './common.js',
        `${f} 가 ${경로} 를 import 한다 — 조각끼리 엮이면 순서에 기대게 된다`)
    }
  }
})

/**
 * 🔴 .js 만 재면 규칙이 반만 지켜진다.
 *   실측 (2026-09-22): 이 검사가 `src/ui/*.js` 만 보는 동안 index.html 은 475줄까지
 *   자랐다(규칙은 400줄) — 대부분이 CSS 였다. 화면 폴더의 **모든** 파일을 잰다.
 */
test('🔴 화면 폴더의 모든 파일이 400줄 규칙 안에 있다', () => {
  for (const f of readdirSync(UI)) {
    const n = 읽기(f).split('\n').length
    assert.ok(n <= 400, `src/ui/${f} 가 ${n}줄이다 — 400줄을 넘으면 단일 책임으로 더 쪼갠다`)
  }
})

test('🔴 화면은 type="module" 로 불러온다 (아니면 import 가 구문 오류다)', () => {
  const html = readFileSync(join(UI, 'index.html'), 'utf8')
  assert.match(html, /<script type="module" src="\/app\.js">/,
    'type="module" 이 없으면 import 줄에서 바로 죽는다')
})

/**
 * 🔴 CSS 를 파일로 뺐으면 **불러오고 내보내야** 한다.
 *   브라우저는 MIME 이 틀린 스타일시트를 조용히 무시한다 — 무늬 없는 화면이 뜨는데
 *   오류는 아무 데도 안 남는다. 404 도 콘솔에만 남는다. 그래서 여기서 못 박는다.
 */
test('🔴 뺀 스타일을 화면이 불러오고 서버가 내보낸다', () => {
  const css = readdirSync(UI).filter((f) => f.endsWith('.css'))
  if (!css.length) return          // 전부 <style> 안에 있다면 확인할 것이 없다
  const html = readFileSync(join(UI, 'index.html'), 'utf8')
  for (const f of css) {
    assert.match(html, new RegExp(`<link rel="stylesheet" href="/${f}">`),
      `${f} 를 불러오지 않으면 화면이 무늬 없이 뜬다`)
  }
  const server = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')
  const i = server.indexOf('.css$/')
  assert.ok(i > 0, '.css 라우트가 있어야 한다')
  assert.match(server.slice(i, i + 200), /text\/css/, 'content-type 이 text\\/css 여야 한다')
  const 규칙 = /^\/[a-z][a-z0-9-]{0,30}\.css$/
  for (const f of css) assert.ok(규칙.test('/' + f), `${f} 가 규칙을 통과하지 못한다`)
  assert.ok(!규칙.test('/../x.css'), '경로 탈출은 막아야 한다')
})

test('🔴 서버가 조각을 전부 내보낸다 (한 개만 열어주면 화면이 안 뜬다)', () => {
  const server = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')
  const m = /\/\^\\\/\[a-z\]\[a-z0-9-\]\{0,\d+\}\\\.js\$\//.exec(server)
  assert.ok(m, '.js 를 이름 규칙으로 내보내는 라우트가 있어야 한다')
  // 그 규칙이 실제로 조각 이름을 통과시키는지, 경로 탈출은 막는지
  const 규칙 = /^\/[a-z][a-z0-9-]{0,30}\.js$/
  for (const f of 모듈들) assert.ok(규칙.test('/' + f), `${f} 가 규칙을 통과하지 못한다`)
  for (const 나쁜 of ['/../package.json', '/a/b.js', '/..%2Fx.js', '/x.mjs', '/A.js']) {
    assert.ok(!규칙.test(나쁜), `${나쁜} 이 통과하면 저장소 바깥을 읽을 수 있다`)
  }
})

/* ── 조각으로 나눈 뒤의 약속 ────────────────────────────────── */

/**
 * 🔴 조각들은 app.js 를 직접 import 하지 않는다 — 순환이 된다.
 *   대신 common.js 의 `동작` 등록소를 거친다. 그 등록을 빠뜨리면 클릭이
 *   **조용히 아무 일도 하지 않는다**(기본값이 빈 함수라 오류조차 안 난다).
 */
test('🔴 조각이 app.js 를 import 하지 않는다 (순환 금지)', () => {
  for (const f of 조각들) {
    const src = readFileSync(join(ROOT, 'src', 'ui', f), 'utf8')
    assert.ok(!/from '\.\/app\.js'/.test(src), `${f} 가 app.js 를 import 한다 — 순환이다`)
  }
})

test('🔴 app.js 가 동작 등록소를 채운다 (빠뜨리면 클릭이 조용히 죽는다)', () => {
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  const m = /Object\.assign\(동작, \{([^}]*)\}\)/.exec(app)
  assert.ok(m, '동작 등록이 있어야 한다')
  for (const k of ['draw', 'loadStatus', 'loadDetail', 'post', '메타']) {
    assert.ok(m[1].includes(k), `동작.${k} 가 등록되지 않았다`)
  }
  // 등록이 폴링 시작보다 앞이어야 한다
  assert.ok(app.indexOf('Object.assign(동작') < app.indexOf('\nloadStatus()'),
    '등록이 첫 갱신보다 뒤면 그 사이의 클릭이 아무 일도 하지 않는다')
})

test('조각이 쓰는 동작은 등록소에 다 있다', () => {
  const 등록 = new Set(['draw', 'loadStatus', 'loadDetail', 'post', '메타'])
  for (const f of 그리는조각) {
    const src = readFileSync(join(ROOT, 'src', 'ui', f), 'utf8')
    for (const m of src.matchAll(/동작\.([^\s(.,)]+)/g)) {
      assert.ok(등록.has(m[1]), `${f} 가 등록되지 않은 동작.${m[1]} 을 쓴다`)
    }
  }
})


/**
 * 🔴 실측 결함 (2026-09-22, 전수 검증 중 발견)
 *
 *   detail.js 가 `n(...)`(숫자 서식)을 쓰면서 common.js 에서 **import 하지 않았다.**
 *   app.js 를 조각으로 나눌 때 한 파일 안에 있던 이름이 목록에서 빠진 것이다.
 *   결과: 세션을 눌러도 상세 패널이 그려지지 않는다 — 탭 여섯 개가 전부
 *   `ReferenceError: n is not defined` 로 죽었다. 파일을 열어봐서는 안 보이고,
 *   import 이름이 **존재하는지**만 보던 기존 검사도 못 잡는다(빠진 것이 문제니까).
 *
 *   그려보는 시험이 가장 확실하지만, 이 정적 검사는 조각이 늘어나도 공짜로 돈다.
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\$]/g, (c) => '\\' + c)

test('🔴 조각이 쓰는 common.js 이름은 반드시 import 되어 있다', () => {
  const common = 읽기('common.js')
  const 내보냄 = new Set()
  for (const m of common.matchAll(/export\s+(?:const|function|let)\s+([^\s(=]+)/g)) 내보냄.add(m[1])
  for (const m of common.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const x of m[1].split(',')) 내보냄.add(x.trim())
  }
  내보냄.delete('')
  assert.ok(내보냄.size >= 8, `common.js 의 export 를 못 읽었다 (${[...내보냄].join(',')})`)

  for (const f of 모듈들.filter((x) => x !== 'common.js')) {
    const src = stripComments(읽기(f))
    const 가져온 = new Set()
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/common\.js'/g)) {
      for (const x of m[1].split(',')) 가져온.add(x.trim().split(/\s+as\s+/)[0])
    }
    for (const 이름 of 내보냄) {
      if (가져온.has(이름)) continue
      // 스스로 선언했으면 제 것이다
      if (new RegExp('(const|let|var|function|class)\\s+' + escapeRegex(이름) + '[\\s(=]').test(src)) continue
      // 이름 뒤에 ( . [ 가 오면 실제로 쓰는 것이다
      const 씀 = new RegExp('(^|[^\\w$가-힣.])' + escapeRegex(이름) + '\\s*[(.[]', 'm')
      assert.ok(!씀.test(src),
        `${f} 가 common.js 의 '${이름}' 을 import 없이 쓴다 — 브라우저에서 ReferenceError 다`)
    }
  }
})
