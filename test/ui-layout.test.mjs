/**
 * ui-layout.test.mjs — 화면 레이아웃의 약속을 고정한다.
 *
 * 왜 시험하나
 *   "세션 목록과 상세가 각각 스크롤되어야 한다"는 요구는 CSS 몇 줄에 걸려 있고,
 *   그 몇 줄은 무심코 지우기 쉽다(특히 `min-height:0` — 없으면 flex 자식이
 *   내용만큼 부풀어 스크롤이 **조용히** 사라진다). 눈으로만 지키면 되돌아간다.
 *
 *   DOM 을 띄우지 않고 파일의 구조·규칙만 본다. 렌더링 검증은 아니지만,
 *   되돌림을 막는 데는 이걸로 충분하다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { uiSource, styleSource } from './_ui-files.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
/**
 * 뼈대(HTML)와 모양(CSS)을 **한 벌로** 본다. CSS 를 app.css 로 뺐을 때
 * index.html 만 읽던 이 시험들이 13개나 한꺼번에 깨졌다 — 규칙이 어느 파일에
 * 있는지는 시험의 관심사가 아니다.
 */
const html = styleSource()
/**
 * 화면 스크립트 **전체**를 하나로 본다.
 *
 * 🔴 app.js 한 파일만 읽으면 안 된다. 781줄이던 app.js 를 조각으로 나눈 뒤
 *   (common·summary·list·detail) 이 시험들이 통째로 깨졌다 — '화면이 X 를 한다'를
 *   확인하려던 것인데 '어느 파일에 X 가 있다'를 확인하고 있었기 때문이다.
 *   앞으로 조각을 더 나눠도 이 시험은 그대로 통한다.
 *
 *   🔴 목록을 손으로 적지도 않는다 — setup.js 를 새로 만들었을 때 시험 다섯 곳 중
 *   한 곳의 목록에서 빠져, 그 파일이 검사에서 통째로 빠졌다. 폴더에서 읽는다.
 */
const appjs = uiSource()

test('🔴 스크롤 영역이 둘 있다 — 목록(#slist)과 상세(#dscroll)', () => {
  assert.match(html, /id="slist"/, '#slist 가 있어야 한다')
  assert.match(html, /id="dscroll"/, '#dscroll 이 있어야 한다')
  assert.match(html, /#slist,\s*#dscroll\s*\{[^}]*overflow-y:\s*auto/,
    '둘 다 overflow-y:auto 여야 각자 스크롤된다')
})

test('🔴 min-height:0 이 있다 — 없으면 flex 안에서 스크롤이 조용히 사라진다', () => {
  assert.match(html, /#slist,\s*#dscroll\s*\{[^}]*min-height:\s*0/,
    '스크롤 영역에 min-height:0 이 필요하다')
  assert.match(html, /\.panel\s*\{[^}]*min-height:\s*0/,
    '패널에도 min-height:0 이 필요하다')
})

test('🔴 페이지 전체는 스크롤하지 않는다 — 그래야 패널이 각자 스크롤한다', () => {
  assert.match(html, /body\s*\{[^}]*overflow:\s*hidden/,
    'body 가 스크롤되면 패널 스크롤이 의미를 잃는다')
  assert.match(html, /html,\s*body\s*\{\s*height:\s*100%/,
    '뷰포트 높이에 묶여 있어야 한다')
})

test('상세 패널이 세로 flex 다 (머리말·탭 고정 + 본문 스크롤)', () => {
  assert.match(html, /\.panel\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/)
  assert.match(html, /\.panel\s*>\s*h2\s*\{[^}]*flex:\s*0 0 auto/, '머리말은 눌리면 안 된다')
  assert.match(html, /\.actions\s*\{[^}]*flex:\s*0 0 auto/, '작업 바는 눌리면 안 된다')
})

test('🔴 스크롤 안에 스크롤을 두지 않는다 (휠이 어디로 갈지 예측할 수 없다)', () => {
  // 타임라인과 로그는 #dscroll 안에 있다. 여기에 max-height + overflow 를 다시 넣으면
  // 중첩 스크롤이 된다.
  assert.doesNotMatch(html, /\.tl\s*\{[^}]*max-height/, '.tl 에 max-height 를 두지 마라')
  assert.doesNotMatch(html, /pre\.log\s*\{[^}]*max-height/, 'pre.log 에 max-height 를 두지 마라')
  assert.doesNotMatch(html, /\.tl\s*\{[^}]*overflow:\s*auto/, '.tl 에 overflow 를 두지 마라')
})

test('상세 내용이 #dscroll 안에 들어 있다', () => {
  const m = /<div id="dscroll">([\s\S]*?)<\/section>/.exec(html)
  assert.ok(m, '#dscroll 블록을 찾을 수 없다')
  for (const id of ['dempty', 'dbody', 'tab-now', 'tab-tl', 'tab-hb', 'tab-rs', 'tab-cfg', 'tab-al']) {
    assert.ok(m[1].includes(`id="${id}"`), `${id} 가 #dscroll 바깥에 있다 — 스크롤되지 않는다`)
  }
})

test('탭 묶음은 #dscroll 바깥이다 — 스크롤해도 탭은 보여야 한다', () => {
  const tabAt = html.indexOf('id="dtabs"')
  const scrollTop2 = html.indexOf('id="dscroll"')
  assert.ok(tabAt > 0 && scrollTop2 > 0)
  assert.ok(tabAt < scrollTop2, '탭이 스크롤 영역 안에 들어가면 함께 밀려 올라간다')
})

test('좁은 화면에서는 페이지 스크롤로 되돌린다 (두 패널이 쌓이면 각자 스크롤은 못 쓴다)', () => {
  const m = /@media \(max-width:1100px\)\s*\{([\s\S]*?)\n\}/.exec(html)
  assert.ok(m, '좁은 화면 규칙이 있어야 한다')
  assert.match(m[1], /body\s*\{\s*overflow:\s*auto/)
  assert.match(m[1], /grid-template-columns:\s*1fr/)
})

/* ── 스크롤 위치 보존 ────────────────────────────────────────── */

test('🔴 다시 그릴 때 스크롤 위치를 보존한다 — 없으면 3초마다 맨 위로 튕긴다', () => {
  assert.match(appjs, /function keepScroll/, '스크롤 보존 함수가 있어야 한다')
  assert.match(appjs, /keepScroll\('#slist'/, '목록에 적용돼야 한다')
  assert.match(appjs, /keepScroll\('#dscroll'/, '상세에 적용돼야 한다')
})

test('상세를 다시 그리는 모든 경로가 보존을 거친다', () => {
  // 상세그리기() 를 직접 부르면 보존을 건너뛴다. 호출은 상세다시그리기() 안에서만.
  const directCalls = [...appjs.matchAll(/(?<!function )(?<!function redrawDetail\(\) \{[\s\S]{0,200})\n\s*drawDetail\(\)/g)]
  assert.match(appjs, /function redrawDetail/)
  assert.ok(directCalls.length <= 1,
    `상세그리기() 직접 호출이 ${directCalls.length}곳 있다 — 상세다시그리기() 를 거쳐야 스크롤이 보존된다`)
})

test('바닥에 붙어 있었으면 바닥에 붙여둔다 (로그는 아래로 자란다)', () => {
  assert.match(appjs, /wasAtBottom/, '바닥 판정이 있어야 한다')
  assert.match(appjs, /scrollTop = box\.scrollHeight/, '바닥이면 바닥으로 되돌려야 한다')
})

test('세션·탭을 바꾸면 맨 위에서 시작한다', () => {
  assert.match(appjs, /toTop/, '전환 시 맨 위로 가는 처리가 있어야 한다')
  assert.match(appjs, /lastDetailKey/, '무엇이 바뀌었는지 기억해야 한다')
})

/* ── 요약 접기 ───────────────────────────────────────────────── */

/**
 * 요약 열 항목이 큰 카드로 깔려 네 줄을 먹었고, 정작 일하는 곳인 세션 목록과
 * 상세가 아래로 밀렸다. 접을 수 있게 만들되 — **경보는 접히면 안 된다.**
 */
test('🔴 경보는 접히는 묶음 바깥에 있다 (접은 채로 감시 끊김이 숨으면 안 된다)', () => {
  const top = html.match(/<div class="top" id="top">([\s\S]*?)<\/div>/)
  assert.ok(top, '#top 묶음을 찾을 수 없다')
  assert.ok(!top[1].includes('id="alerts"'),
    '경보가 #top 안에 있으면 요약을 접을 때 함께 사라진다 — 이 도구의 존재 이유가 사라진다')
  assert.match(html, /class="alerts-wrap"/, '경보는 자기 묶음을 가져야 한다')
})

test('🔴 요약을 접는 단추가 있고, 화살표 모양만으로 말하지 않는다', () => {
  assert.match(html, /id="btnTop"/, '접기 단추가 있어야 한다')
  assert.match(html, /aria-expanded=/, '펼침 상태를 보조기술에도 알려야 한다')
  assert.match(html, /aria-controls="top"/, '무엇을 접는지 가리켜야 한다')
  assert.match(html, /id="btnTopTx"/, '상태를 글자로도 적어야 한다 — 화살표만으로는 뜻이 갈린다')
})

test('🔴 접기 단추는 요약 묶음 바로 위에 붙어 있다 (머리말 구석에 두니 눈에 안 띄었다)', () => {
  const btn = html.indexOf('id="btnTop"')
  const group = html.indexOf('<div class="top" id="top">')
  const headEnd = html.indexOf('</header>')
  assert.ok(btn > 0 && group > 0 && headEnd > 0)
  assert.ok(btn > headEnd, '접기 단추가 머리말 안에 있으면 무엇을 접는지 안 보인다')
  assert.ok(btn < group, '접기 단추는 접히는 묶음 바로 앞에 있어야 한다')
  assert.match(html, /class="sumbar"/, '띠 자체가 단추여야 누르기 쉽다')
})

test('접은 상태를 기억한다 — 열 때마다 다시 접게 하지 않는다', () => {
  assert.match(appjs, /localStorage/, '접힘 상태를 저장해야 한다')
  assert.match(appjs, /applySummary\(/, '적용 함수를 통해야 상태가 한 곳에서 관리된다')
  assert.match(appjs, /aria-expanded/, 'JS 도 aria 를 갱신해야 한다')
})

test('🔴 접었을 때도 한 줄 요지는 남는다 (접는 것은 자리를 비우는 것이지 포기가 아니다)', () => {
  assert.match(html, /id="sumdigest"/, '요지를 담을 자리가 있어야 한다')
  assert.match(html, /\.sumbar\[aria-expanded="true"\] \.sumdigest\{display:none\}/,
    '펴 있을 때는 요지가 중복이므로 감춘다')
  assert.match(appjs, /function updateDigest/, '요지를 채우는 코드가 있어야 한다')
  assert.match(appjs, /updateDigest\(d\)/, '상태를 받을 때마다 갱신해야 한다')
})

/* ── 묶음 배치: "한번에 파악"의 핵심 ────────────────────────── */

/**
 * 🔴 낱장을 줄이는 것으로는 안 됐다.
 *   처음엔 큰 카드 열 장이 네 줄을 먹어서 작게 줄였다. 그런데도 사용자는
 *   "한번에 파악하기 어렵다"고 했다 — 열 장이 **다 똑같이 생겨서** 어디를 봐야
 *   할지 알 수 없었던 것이다. 계정 얘기와 OS 예약 얘기가 같은 무게로 나란히
 *   있으면 눈이 붙잡을 곳이 없다. 크기 문제가 아니라 **묶음** 문제였다.
 */
test('🔴 요약은 묶음으로 나뉜다 — 같은 질문에 답하는 것끼리 모은다', () => {
  assert.match(html, /class="groups"/, '묶음 컨테이너가 있어야 한다')
  assert.match(html, /\.grp\{/, '묶음 칸 스타일이 있어야 한다')
  assert.match(html, /\.grp > h3\{/, '묶음마다 이름이 있어야 한다 — 이름 없는 묶음은 묶음이 아니다')

  for (const name of ['계정', '실행 중', '사용량', 'OS 트리거']) {
    assert.ok(appjs.includes(`group('${name}')`), `'${name}' 묶음이 없다`)
  }
})

test('🔴 이름과 값은 한 줄에 마주 놓이고 값은 오른쪽에 모인다 (세로로 훑힌다)', () => {
  assert.match(html, /\.gtop\{[^}]*display:\s*flex/, '이름과 값이 한 줄에 마주 놓여야 한다')
  assert.match(html, /\.gtop > \.v\{[^}]*text-align:\s*right/,
    '값이 오른쪽에 정렬돼야 눈이 한 줄로 훑는다')
  assert.match(html, /\.gtop > \.v\{[^}]*text-overflow:\s*ellipsis/,
    '긴 값은 잘라야 줄이 무너지지 않는다')
})

/**
 * 🔴 세부를 hover 로만 남기면 안 된다.
 *   한 번 그렇게 했다가 "너무 심플하다"는 말을 들었고, 그 말이 맞다. 이 화면은
 *   무엇이 잘못됐는지 **판단하는** 자리다 — "해제됨"만 보이고 언제 기록된 것인지
 *   안 보이면 지금 상태인지 알 수 없다. 값만 던지고 근거를 감추면 판단할 수 없다.
 */
test('🔴 세부 설명이 화면에 보인다 (title 에만 두면 근거가 감춰진다)', () => {
  assert.match(appjs, /if \(desc\) r\.append\(el\('div', 'gd', desc\)\)/,
    '설명을 실제 줄로 그려야 한다')
  assert.match(html, /\.gd\{/, '세부 줄 스타일이 있어야 한다')
  // 근거에 줄바꿈이 있는 것(창 목록 등)은 그대로 보여야 한다
  assert.match(html, /\.gd\{[^}]*white-space:\s*pre-line/, '줄바꿈을 살려야 한다')
})

test('🔴 세부에는 상한이 있다 — 없으면 요약이 다시 화면을 먹는다', () => {
  const m = /-webkit-line-clamp:\s*(\d+)/.exec(html)
  assert.ok(m, '세부 줄 수 상한이 있어야 한다')
  assert.ok(Number(m[1]) >= 2 && Number(m[1]) <= 4,
    `세부 상한이 ${m[1]}줄이다 — 2~4줄이어야 근거를 보여주면서 자리를 지킨다`)
  assert.match(appjs, /r\.title = desc/, '상한을 넘친 부분은 title 에 남아야 한다')
})

test('🔴 상태는 색만으로 나르지 않는다 — 배지가 아이콘과 라벨을 함께 담는다', () => {
  assert.match(appjs, /badge\('good', '●', w\.isRunning/, '정상일 때도 말로 적어야 한다')
  assert.match(appjs, /badge\('crit', '▲', '미등록'\)/, '미등록 배지가 있어야 한다')
  assert.match(appjs, /badge\('warn', '■', '멈춰 있음'\)/, '멈춤 배지가 있어야 한다')
  assert.match(appjs, /badge\('crit', '▲', '실패'\)/, '실패 배지가 있어야 한다')
})

test('🔴 OS 트리거 값은 배지 하나다 — 상태 글자와 겹쳐 적으면 좁은 칸에서 잘린다', () => {
  const i = appjs.indexOf("group('OS 트리거')")
  assert.ok(i > 0)
  const section = appjs.slice(i, appjs.indexOf('box.append(g4)', i))
  // 배지를 다섯 번째 인자로 따로 넘기면 값 + 배지가 같은 칸에 둘 다 들어간다
  assert.ok(/line\(g4, label, value, desc\)/.test(section),
    'OS 트리거 줄은 값(배지) 하나만 넘겨야 한다')
  assert.ok(!/값 = w\.상태/.test(section), '상태 글자를 값으로 쓰면 배지와 중복된다')
  // 긴 결과뜻을 배지 라벨에 넣으면 칸을 넘친다 — title 과 경보 배너가 맡는다
  assert.ok(!/badge\([^)]*\$\{w\.resultText\}/.test(section), '결과뜻을 배지 라벨에 넣지 마라 — 칸을 넘친다')
  assert.ok(/desc = .*resultText/.test(section), '결과뜻은 설명(title)에 남겨야 한다')
})

test('요약을 접으면 본문이 그 공간을 가져간다', () => {
  // main 이 flex:1 1 auto 라서, .top 이 사라지면 자동으로 넓어진다
  assert.match(html, /main\{[^}]*flex:\s*1 1 auto/, 'main 이 남는 공간을 가져가야 한다')
  assert.match(html, /\.top\{[^}]*flex:\s*0 0 auto/, '요약은 제 높이만 차지해야 한다')
})
