/**
 * docs.test.mjs — 문서가 **없는 것을 가리키지 않는가.**
 *
 * 🔴 왜 (이 저장소가 반복해서 다친 부류)
 *   설명서가 `npm run resume:rearm` 이라고 적어 뒀는데 그 스크립트가 없으면, 사람은
 *   시키는 대로 하고 실패한 뒤 **도구를 의심하는 게 아니라 자기를 의심한다.**
 *   그리고 이 저장소는 이미 같은 부류로 여러 번 다쳤다 — 읽지 않는 설정(config.test),
 *   화면이 보내는데 서버가 안 받는 키(http.test), 없는 이름을 가리키는 @param(naming.test).
 *   **문서도 같은 규칙을 받는다.**
 *
 * 🔴 숫자는 검사하지 않는다(시험 개수 같은 것). 그런 것은 적지 않는 편이 낫고,
 *   적었다면 어차피 금방 낡는다 — 검사할 것은 **가리키는 대상이 있는가**다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS = ['Manual.md', 'README.md', 'CLAUDE.md', 'docs/claude-auto-retry.md']
const read = (f) => readFileSync(join(ROOT, f), 'utf8')
const scripts = JSON.parse(read('package.json')).scripts || {}

test('🔴 문서가 가리키는 npm 명령이 실제로 있다', () => {
  const missing = []
  for (const f of DOCS) {
    for (const m of read(f).matchAll(/npm run ([\w:-]+)/g)) {
      if (!scripts[m[1]]) missing.push(`${f}: npm run ${m[1]}`)
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    `문서가 없는 명령을 시킨다 — 사람은 시키는 대로 하고 실패한다:\n  ${missing.join('\n  ')}`)
})

test('🔴 문서가 가리키는 파일·폴더가 실제로 있다', () => {
  const missing = []
  for (const f of DOCS) {
    const base = f.includes('/') ? join(ROOT, 'docs') : ROOT
    for (const m of read(f).matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]*)?\)/g)) {
      const target = join(base, m[1])
      if (!existsSync(target)) missing.push(`${f} → ${m[1]}`)
    }
  }
  assert.deepEqual([...new Set(missing)], [],
    `문서의 링크가 없는 곳을 가리킨다:\n  ${missing.join('\n  ')}`)
})

test('🔴 검사기가 헛돌지 않는다 (없는 것을 넣으면 잡아야 한다)', () => {
  assert.equal(Boolean(scripts['그런명령없음']), false)
  assert.equal(existsSync(join(ROOT, '그런파일없음.md')), false)
})

/* ── 설명서가 실제 화면·동작과 맞는가 ────────────────────────── */

test('🔴 설명서의 단추 이름이 화면의 단추와 같다', () => {
  const html = read('src/ui/index.html')
  const manual = read('Manual.md')
  const buttons = [...html.matchAll(/data-act="[^"]*">([^<]+)</g)].map((m) => m[1].trim())
  assert.ok(buttons.length >= 6, `단추를 못 읽었다 (${buttons.length}개)`)
  for (const b of buttons) {
    assert.ok(manual.includes(b), `설명서에 '${b}' 단추가 없다 — 화면과 설명이 갈라졌다`)
  }
})

test('🔴 설명서의 상세 탭 이름이 화면의 탭과 같다', () => {
  const html = read('src/ui/index.html')
  const manual = read('Manual.md')
  const tabs = [...html.matchAll(/data-tab="[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1].trim())
  assert.ok(tabs.length >= 6, `탭을 못 읽었다 (${tabs.length}개)`)
  for (const t of tabs) {
    assert.ok(manual.includes(t), `설명서에 '${t}' 탭이 없다`)
  }
})

test('🔴 설명서가 말하는 재시작 결과가 코드가 내는 것과 같다', () => {
  // 결과 이름을 정하는 자리는 classify.classifyRun 하나다(resume.mjs 는 그것을 부른다)
  const src = read('src/lib/classify.mjs')
  const manual = read('Manual.md')
  const results = ['ok', 'limited', 'auth', 'overload', 'timeout', 'fail']
  for (const r of results) {
    assert.match(src, new RegExp(`'${r}'`), `classifyRun 이 '${r}' 를 더는 내지 않는다`)
    assert.ok(manual.includes(`\`${r}\``), `설명서에 결과 '${r}' 설명이 없다`)
  }
})

/**
 * 🔴 배지 문구는 **화면과 설명서 양쪽에 같은 말**로 있어야 한다.
 *
 *   실측 (2026-09-22): 배지 문구를 두 번 고쳤고 두 번 다 설명서가 뒤처졌다.
 *   설명서에 `⊘ 재개 안 함` 이라 적혀 있는데 화면은 `재시작 켬 · 지금은 대기` 를
 *   보여주면, 사람은 자기가 보는 것이 무엇인지 설명서에서 찾을 수 없다.
 *   숫자가 아니라 **말**이라 눌러 보면 바로 드러나는데, 그래서 더 잘 잊는다.
 */
test('🔴 설명서의 배지 문구가 화면이 실제로 그리는 말과 같다', () => {
  const list = read('src/ui/list.js')
  const manual = read('Manual.md')
  // 스위치 상태는 어느 경우에도 배지 맨 앞에 온다 — 양쪽에 다 있어야 한다
  for (const stem of ['재시작 꺼짐', '재시작 켬', '감시 꺼짐', '감시 켬', '대기', '가능', '차단']) {
    assert.ok(list.includes(stem), `list.js 가 '${stem}' 를 더는 그리지 않는다`)
    assert.ok(manual.includes(stem), `설명서에 '${stem}' 가 없다 — 화면과 설명이 갈라졌다`)
  }
})

test('🔴 설명서가 말하는 동작줄 결과 문구가 실제 문구와 같다', () => {
  const app = read('src/ui/app.js')
  const manual = read('Manual.md')
  for (const stem of ['재시작을 켰습니다', '감시를 켰습니다']) {
    assert.ok(app.includes(stem), `app.js 가 '${stem}' 를 더는 말하지 않는다`)
  }
  assert.ok(manual.includes('재시작을 켰습니다'), '설명서에 결과 문구 예시가 있어야 한다')
})

/**
 * 🔴 화면에 **새로 생긴 조작**은 설명서에 있어야 한다.
 *
 *   실측: 배지 문구를 두 번 고치고 두 번 다 설명서가 뒤처졌다. 조작(드래그 손잡이·
 *   접기 단추)은 더 나쁘다 — 눌러 볼 생각을 못 하면 있는 기능을 **모르고 지나간다.**
 *   화면에 그 요소가 있으면 설명서가 그것을 가리켜야 한다.
 */
test('🔴 화면의 조작 요소를 설명서가 가리킨다', () => {
  const html = read('src/ui/index.html')
  const manual = read('Manual.md')
  const pairs = [
    [/id="split"/, ['드래그', '더블클릭'], '너비 조절 손잡이'],
    [/id="btnSessFold"/, ['접기'], '세션 영역 접기'],
    [/id="btnSetup"/, ['설정'], 'PC 설정'],
    [/data-tab="cfg"/, ['재개지시'], '설정 탭'],
  ]
  for (const [inHtml, words, what] of pairs) {
    if (!inHtml.test(html)) continue          // 화면에 없으면 설명할 것도 없다
    for (const w of words) {
      assert.ok(manual.includes(w), `설명서가 '${what}' 를 설명하지 않는다 ('${w}' 가 없다)`)
    }
  }
})

test('🔴 설명서가 말하는 최소 너비가 코드의 값과 같다', () => {
  const layout = read('src/ui/layout.js')
  const manual = read('Manual.md')
  const min = /MIN_SESSION\s*=\s*(\d+)/.exec(layout)
  const minD = /MIN_DETAIL\s*=\s*(\d+)/.exec(layout)
  assert.ok(min && minD, '최소 너비가 코드에 있어야 한다')
  assert.ok(manual.includes(`${min[1]}px`), `설명서의 세션 최소 너비가 코드(${min[1]}px)와 다르다`)
  assert.ok(manual.includes(`${minD[1]}px`), `설명서의 상세 최소 너비가 코드(${minD[1]}px)와 다르다`)
})
