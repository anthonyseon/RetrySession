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

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const html = readFileSync(join(ROOT, 'src', 'ui', 'index.html'), 'utf8')
const appjs = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')

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
  const 탭위치 = html.indexOf('id="dtabs"')
  const 스크롤위치 = html.indexOf('id="dscroll"')
  assert.ok(탭위치 > 0 && 스크롤위치 > 0)
  assert.ok(탭위치 < 스크롤위치, '탭이 스크롤 영역 안에 들어가면 함께 밀려 올라간다')
})

test('좁은 화면에서는 페이지 스크롤로 되돌린다 (두 패널이 쌓이면 각자 스크롤은 못 쓴다)', () => {
  const m = /@media \(max-width:1100px\)\s*\{([\s\S]*?)\n\}/.exec(html)
  assert.ok(m, '좁은 화면 규칙이 있어야 한다')
  assert.match(m[1], /body\s*\{\s*overflow:\s*auto/)
  assert.match(m[1], /grid-template-columns:\s*1fr/)
})

/* ── 스크롤 위치 보존 ────────────────────────────────────────── */

test('🔴 다시 그릴 때 스크롤 위치를 보존한다 — 없으면 3초마다 맨 위로 튕긴다', () => {
  assert.match(appjs, /function 스크롤유지/, '스크롤 보존 함수가 있어야 한다')
  assert.match(appjs, /스크롤유지\('#slist'/, '목록에 적용돼야 한다')
  assert.match(appjs, /스크롤유지\('#dscroll'/, '상세에 적용돼야 한다')
})

test('상세를 다시 그리는 모든 경로가 보존을 거친다', () => {
  // 상세그리기() 를 직접 부르면 보존을 건너뛴다. 호출은 상세다시그리기() 안에서만.
  const 직접호출 = [...appjs.matchAll(/(?<!function )(?<!function 상세다시그리기\(\) \{[\s\S]{0,200})\n\s*상세그리기\(\)/g)]
  assert.match(appjs, /function 상세다시그리기/)
  assert.ok(직접호출.length <= 1,
    `상세그리기() 직접 호출이 ${직접호출.length}곳 있다 — 상세다시그리기() 를 거쳐야 스크롤이 보존된다`)
})

test('바닥에 붙어 있었으면 바닥에 붙여둔다 (로그는 아래로 자란다)', () => {
  assert.match(appjs, /바닥이었나/, '바닥 판정이 있어야 한다')
  assert.match(appjs, /scrollTop = box\.scrollHeight/, '바닥이면 바닥으로 되돌려야 한다')
})

test('세션·탭을 바꾸면 맨 위에서 시작한다', () => {
  assert.match(appjs, /맨위로/, '전환 시 맨 위로 가는 처리가 있어야 한다')
  assert.match(appjs, /마지막상세키/, '무엇이 바뀌었는지 기억해야 한다')
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
  const 단추 = html.indexOf('id="btnTop"')
  const 묶음 = html.indexOf('<div class="top" id="top">')
  const 머리끝 = html.indexOf('</header>')
  assert.ok(단추 > 0 && 묶음 > 0 && 머리끝 > 0)
  assert.ok(단추 > 머리끝, '접기 단추가 머리말 안에 있으면 무엇을 접는지 안 보인다')
  assert.ok(단추 < 묶음, '접기 단추는 접히는 묶음 바로 앞에 있어야 한다')
  assert.match(html, /class="sumbar"/, '띠 자체가 단추여야 누르기 쉽다')
})

test('접은 상태를 기억한다 — 열 때마다 다시 접게 하지 않는다', () => {
  assert.match(appjs, /localStorage/, '접힘 상태를 저장해야 한다')
  assert.match(appjs, /요약적용\(/, '적용 함수를 통해야 상태가 한 곳에서 관리된다')
  assert.match(appjs, /aria-expanded/, 'JS 도 aria 를 갱신해야 한다')
})

test('🔴 접었을 때도 한 줄 요지는 남는다 (접는 것은 자리를 비우는 것이지 포기가 아니다)', () => {
  assert.match(html, /id="sumdigest"/, '요지를 담을 자리가 있어야 한다')
  assert.match(html, /\.sumbar\[aria-expanded="true"\] \.sumdigest\{display:none\}/,
    '펴 있을 때는 요지가 중복이므로 감춘다')
  assert.match(appjs, /function 요지갱신/, '요지를 채우는 코드가 있어야 한다')
  assert.match(appjs, /요지갱신\(d\)/, '상태를 받을 때마다 갱신해야 한다')
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

  for (const 이름 of ['계정', '실행 중', '사용량', 'OS 트리거']) {
    assert.ok(appjs.includes(`묶음('${이름}')`), `'${이름}' 묶음이 없다`)
  }
})

test('🔴 묶음 안은 이름·값 두 칸이고 값은 오른쪽에 모인다 (세로로 훑힌다)', () => {
  assert.match(html, /\.grow\{[^}]*grid-template-columns:\s*auto 1fr/,
    '이름과 값 두 칸이어야 한다')
  assert.match(html, /\.grow > \.v\{[^}]*text-align:\s*right/,
    '값이 오른쪽에 정렬돼야 눈이 한 줄로 훑는다')
  assert.match(html, /\.grow > \.v\{[^}]*text-overflow:\s*ellipsis/,
    '긴 값은 잘라야 줄이 무너지지 않는다')
})

test('🔴 화면에 안 보이는 설명은 title 로 남는다 (자르면서 버리면 안 된다)', () => {
  assert.match(appjs, /r\.title = 설명/, '줄마다 설명 전체를 title 에 남겨야 한다')
})

test('🔴 상태는 색만으로 나르지 않는다 — 배지가 아이콘과 라벨을 함께 담는다', () => {
  assert.match(appjs, /badge\('good', '●', w\.돌고있음/, '정상일 때도 말로 적어야 한다')
  assert.match(appjs, /badge\('crit', '▲', '미등록'\)/, '미등록 배지가 있어야 한다')
  assert.match(appjs, /badge\('warn', '■', '멈춰 있음'\)/, '멈춤 배지가 있어야 한다')
  assert.match(appjs, /badge\('crit', '▲', '실패'\)/, '실패 배지가 있어야 한다')
})

test('🔴 OS 트리거 값은 배지 하나다 — 상태 글자와 겹쳐 적으면 좁은 칸에서 잘린다', () => {
  const i = appjs.indexOf("묶음('OS 트리거')")
  assert.ok(i > 0)
  const 구간 = appjs.slice(i, appjs.indexOf('box.append(g4)', i))
  // 배지를 다섯 번째 인자로 따로 넘기면 값 + 배지가 같은 칸에 둘 다 들어간다
  assert.ok(/줄\(g4, 라벨, 값, 설명\)/.test(구간),
    'OS 트리거 줄은 값(배지) 하나만 넘겨야 한다')
  assert.ok(!/값 = w\.상태/.test(구간), '상태 글자를 값으로 쓰면 배지와 중복된다')
  // 긴 결과뜻을 배지 라벨에 넣으면 칸을 넘친다 — title 과 경보 배너가 맡는다
  assert.ok(!/badge\([^)]*\$\{w\.결과뜻\}/.test(구간), '결과뜻을 배지 라벨에 넣지 마라 — 칸을 넘친다')
  assert.ok(/설명 = .*결과뜻/.test(구간), '결과뜻은 설명(title)에 남겨야 한다')
})

test('요약을 접으면 본문이 그 공간을 가져간다', () => {
  // main 이 flex:1 1 auto 라서, .top 이 사라지면 자동으로 넓어진다
  assert.match(html, /main\{[^}]*flex:\s*1 1 auto/, 'main 이 남는 공간을 가져가야 한다')
  assert.match(html, /\.top\{[^}]*flex:\s*0 0 auto/, '요약은 제 높이만 차지해야 한다')
})
