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

/**
 * 🔴 경보 제목이 설명서의 경보표에 **그대로** 있어야 한다.
 *
 *   실측 (2026-09-28): 경보 두 가지(로그인끊김·인증실패)를 새로 넣으면서 설명서 §7 은
 *   **손으로** 고쳐야 했다. 잊었다면 화면에는 «로그인이 끊겼습니다» 가 뜨는데 설명서에는
 *   그 말이 없는 상태가 된다 — 급한 사람이 찾는 자리에 없는 것이다.
 *   배지 문구·단추·탭에 이미 같은 규칙을 걸어 뒀으니 경보도 같은 대접을 받는다.
 *
 *   **제목을 그대로** 비교한다(뜻이 같은 다른 말이 아니라). 사람은 화면에 뜬 문장을
 *   그대로 찾기 때문이다.
 */
/**
 * 🔴 "몇 분 조용해야 하나"는 **네 곳**에 적혀 있다 — 설정·판정의 기본값·설명서·화면.
 *
 *   설정 하나를 고치면 나머지 셋이 뒤처지고, 그러면 화면은 «10분 이상 조용하다» 라고
 *   적어 둔 채 3분에 이어받는다. 숫자가 말과 다른 화면은 사람이 판단할 수 없게 만든다.
 *   정본은 `config/projects.json` 의 `defaults.resume.sessionActiveMin` 이고,
 *   나머지 셋이 그 숫자를 그대로 말하는지 기계가 잰다.
 */
test('🔴 "조용해야 하는 시간"이 설정·판정·설명서·화면에서 같은 숫자다', () => {
  const cfg = JSON.parse(read('config/projects.json')).defaults.resume.sessionActiveMin
  assert.equal(typeof cfg, 'number', '설정에 sessionActiveMin 이 없다')

  // 판정의 기본값(설정을 못 읽었을 때)도 같아야 한다
  const gate = read('src/lib/resume-gate.mjs')
  const fallback = /cfg\.sessionActiveMin \?\? (\d+)/.exec(gate)
  assert.ok(fallback, '판정에서 sessionActiveMin 기본값을 못 찾았다')
  assert.equal(Number(fallback[1]), cfg, `판정 기본값 ${fallback[1]} ≠ 설정 ${cfg}`)

  // 화면과 설명서가 같은 숫자를 말하는가
  // 마크업은 옮겨 다닐 수 있다 — 지켜야 하는 것은 **숫자**와 "조용" 이라는 말이다
  const html = read('src/ui/index.html')
  assert.match(html, new RegExp(`${cfg}분 이상`), `화면이 ${cfg}분이라고 말해야 한다`)
  assert.match(html, /조용/, '무엇이 3분인지(조용한 시간) 말해야 한다')
  const manual = read('Manual.md')
  assert.match(manual, new RegExp(`\\*\\*${cfg}분 이상\\*\\* 조용하다`), `설명서 §5-1 이 ${cfg}분이어야 한다`)
  assert.match(manual, new RegExp(`활동이 있었다 \\(${cfg}분\\)`), `설명서의 막는 조건표도 ${cfg}분이어야 한다`)
  assert.match(read('src/lib/resume-gate.mjs'), new RegExp(`기본 ${cfg}분`), '판정 주석도 같은 숫자를 말해야 한다')
  assert.match(read('README.md'), new RegExp(`기본 ${cfg}분`), `README 가드 목록도 ${cfg}분이어야 한다`)
})

/**
 * 🔴 화면 맨 위의 "언제 이어받는가" 설명이 **판정과 같은 말**이어야 한다.
 *
 *   실측 (2026-09-28): 제한이 풀린 순간 이어받는 것이 이 도구의 목적인데 539회 연속
 *   건너뛰어졌고, 조건이 화면에 없어서 사람은 로그를 열어야 알 수 있었다. 그래서 설명을
 *   화면에 넣었다 — 그런데 설명과 판정이 갈라지면 **틀린 설명이 화면에 붙어 있는** 것이라
 *   없느니만 못하다. 조건에 쓰이는 이름이 판정 코드에 실제로 있는지 기계가 잰다.
 */
/**
 * 🔴 접힌 제목의 **조건 단어**가 표의 첫 칸과 같아야 한다 (사용자 지시 2026-09-28).
 *
 *   접힌 줄은 «재시작 켬 · 일 없음 · 3분 조용 …» 처럼 단어만 늘어놓고, 펴면 그 단어에
 *   배지와 뜻이 붙는다. 둘이 어긋나면 접힌 줄에서 본 말을 표에서 못 찾는다 —
 *   단어로 쓰는 이유가 «훑고 나서 그 자리를 찾는 것» 인데 그걸 잃는다.
 */
test('🔴 접힌 제목의 조건 단어가 표의 첫 칸과 같다', () => {
  const html = read('src/ui/index.html')
  const summary = /<span class="cond">([^<]+)<\/span>/.exec(html)
  assert.ok(summary, '접힌 줄의 조건 단어 목록을 찾지 못했다')
  const words = summary[1].split('·').map((s) => s.trim()).filter(Boolean)
  assert.ok(words.length >= 6, `조건 단어가 ${words.length}개뿐이다`)

  const table = /<table>[\s\S]*?<\/table>/.exec(html)
  assert.ok(table, '조건 표를 찾지 못했다')
  const firstCells = [...table[0].matchAll(/<tr><td><b>([^<]+)<\/b><\/td>/g)].map((m) => m[1].trim())
  assert.deepEqual(words, firstCells,
    `접힌 줄과 표의 첫 칸이 다르다 — 훑은 말을 표에서 찾을 수 없다\n  접힌 줄: ${words.join(' / ')}\n  표: ${firstCells.join(' / ')}`)
})

test('🔴 화면의 "언제 이어받는가" 설명이 판정과 같은 것을 가리킨다', () => {
  const html = read('src/ui/index.html')
  const gate = read('src/lib/resume-gate.mjs')
  assert.match(html, /<details class="howto"/, '화면 맨 위의 설명이 없다')
  // 설명이 말하는 다섯 조건이 판정에도 있어야 한다
  for (const key of ['stoppedByLimit', 'sessionActiveMin', 'quietHours', 'budgetVerdict', 'limitState']) {
    assert.ok(gate.includes(key), `판정에 ${key} 가 없는데 화면이 그 조건을 설명한다`)
  }
  assert.match(html, /sessionActiveMin/, '조용해야 하는 시간의 설정 이름을 적어야 고칠 수 있다')
  assert.match(html, /재시작 시작/, '어느 단추로 켜는지 적어야 한다')
  // 설명서에도 같은 조건이 있어야 한다 (화면을 못 보고 읽는 사람이 있다)
  const manual = read('Manual.md')
  assert.match(manual, /제한이 풀리|제한 해제/, '설명서에 제한 해제 재개 조건이 없다')
  assert.match(manual, /한 글자도/, '“사람이 입력하지 않았다”가 핵심 조건이다 — 설명서에도 있어야 한다')
  // 🔴 pid 로 막지 않는다는 것이 이 기능의 요점이다 — 설명서가 그것을 말해야 한다
  assert.match(manual, /창이 열려 있는 것 자체는 막지 않는다/, '창이 열려 있어도 이어받는다고 적어야 한다')
})

/**
 * 🔴 사용량 줄의 표(`오늘`·`누적`)와 그 뜻이 설명서에 있어야 한다.
 *   숫자 두 줄이 나란히 있는 화면은 **어느 쪽이 무엇인지** 문서가 말해주지 않으면
 *   사람이 추측한다. 그리고 추측은 "오늘 얼마 썼나"를 반대로 읽는 쪽으로도 간다.
 */
test('🔴 사용량을 오늘·누적으로 가른 것이 설명서에 있다', () => {
  const list = read('src/ui/list.js')
  const manual = read('Manual.md')
  assert.match(list, /row\('오늘'/, '목록이 오늘 줄을 그려야 한다')
  assert.match(list, /row\('누적'/, '목록이 누적 줄을 그려야 한다')
  for (const w of ['오늘', '누적', '로컬 자정']) {
    assert.ok(manual.includes(w), `설명서가 '${w}' 를 설명하지 않는다`)
  }
  assert.match(manual, /이하/, '오늘 ≤ 누적 이라는 성질을 적어야 한다 — 뒤집혀 보이면 결함이다')
})

test('🔴 경보 제목이 설명서의 경보표에 있다', () => {
  const src = read('src/lib/alerts.mjs')
  const manual = read('Manual.md')
  const titles = [...src.matchAll(/push\(\s*'[^']+',\s*'(?:critical|warning|info)',\s*'([^']+)'/g)]
    .map((m) => m[1])
  assert.ok(titles.length >= 12, `경보 제목을 못 읽었다 (${titles.length}개) — 정규식이 헛돌고 있다`)
  const missing = titles.filter((t) => !manual.includes(t))
  assert.deepEqual(missing, [],
    `설명서 §7 에 없는 경보가 있다 — 뜬 문장을 그대로 찾을 수 없다:\n  ${missing.join('\n  ')}`)
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
