/**
 * ui-errors.test.mjs — **무엇이 잘못됐는지 화면이 말하는가.**
 *
 * 🔴 이 저장소가 반복해서 틀린 지점이다. 고칠 수 있는 이유를 숫자로 바꿔 놓거나
 *   (HTTP 500 · 코드 4294967295), 실패를 조용히 넘겨(상세가 안 열림) 사람이
 *   화면이 멈춘 줄 알게 만들었다. 감시 장치는 이유를 말해야 한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './_ui-harness.mjs'

/* ── 서버가 오류로 답했을 때 화면이 말하는가 ─────────────────── */

/**
 * 🔴 실측 결함 (2026-09-21, 전수 검증 중)
 *   `throw new Error('HTTP ' + r.status)` 였다. 서버는 본문에
 *   `{"오류":"등록부가 깨졌다 (…): Expected property name…"}` 를 담아 보내는데
 *   화면은 그걸 버리고 "HTTP 500" 만 보여줬다 — 고칠 수 있는 이유를 숫자로
 *   바꿔 놓은 셈이다. 코드 4294967295 와 같은 부류의 실수다.
 */
test('🔴 서버가 보낸 이유를 버리지 않는다 (HTTP 500 만 보여주면 조치할 수 없다)', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  assert.match(src, /async function 오류이유/, '본문에서 이유를 꺼내는 함수가 있어야 한다')
  assert.match(src, /await 오류이유\(r\)/, '상태 읽기가 그 함수를 써야 한다')
  // 🔴 주석을 뺀 코드만 본다. 옛 코드를 설명하는 주석이 검사에 걸려서는 안 된다
  //   (이 저장소에서 같은 함정에 두 번 걸렸다 — 근거를 적으면 그 근거가 걸린다).
  const 코드 = src.split('\n')
    .filter((l) => { const t = l.trim(); return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') })
    .join('\n')
  assert.ok(!/throw new Error\('HTTP ' \+ r\.status\)/.test(코드),
    '상태 코드만 던지면 이유가 사라진다')
  // JSON 이 아닐 때의 대비도 있어야 한다
  const i = src.indexOf('async function 오류이유')
  assert.match(src.slice(i, i + 400), /HTTP \$\{r\.status\}/, 'JSON 이 아니면 코드로 물러서야 한다')
})

test('🔴 상태를 못 읽으면 그것을 가장 급한 경보로 띄운다', () => {
  const sum = readFileSync(join(ROOT, 'src', 'ui', 'summary.js'), 'utf8')
  const i = sum.indexOf('function 경보그리기')
  const 구간 = sum.slice(i, i + 1200)
  assert.match(구간, /S\.오류/, '읽기 실패를 경보 목록에 넣어야 한다')
  assert.match(구간, /unshift/, '가장 위에 놓아야 한다 — 나머지 전부가 낡았다는 뜻이다')
  assert.match(구간, /critical/, '치명으로 다뤄야 한다')
  // 상태가 없을 때도 경보는 그려야 한다(첫 요청부터 실패한 경우)
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  assert.match(app, /경보그리기\(null\)/, '상태가 없어도 경보는 그려야 빈 화면이 안 된다')
})

test('세션 상세를 못 읽으면 그 이유를 적는다 (조용히 넘기면 멈춘 줄 안다)', () => {
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  const det = readFileSync(join(ROOT, 'src', 'ui', 'detail.js'), 'utf8')
  assert.match(app, /S\.상세오류/, '상세 읽기 실패를 기억해야 한다')
  assert.match(det, /이 세션의 상세를 읽을 수 없습니다/, '화면에 이유를 적어야 한다')
})


/* ── 조각 하나가 죽어도 화면 전체를 잃지 않는다 ──────────────── */

/**
 * 🔴 실측 결함 (2026-09-22, 사용자 보고: "세션 목록에 아무 것도 없다")
 *
 *   그리기() 가 `경보그리기(d); 타일들(d); 폴더그리기(d); 설정그리기()` 를 한 줄에
 *   이어 부르고 **그 다음에** 목록을 그렸다. summary.js 에 남은 죽은 코드가
 *   ReferenceError 를 내자 뒤가 전부 실행되지 않아 세션 목록이 빈 채로 남았다 —
 *   서버는 그때 8개를 정상으로 돌려주고 있었다. 있는 것을 없다고 말한 것이다.
 *
 *   조각별로 잡고, 잡은 것은 숨기지 않고 화면에 적는다.
 */
test('🔴 조각그리기 — 던진 조각만 실패로 남고 나머지는 계속 그린다', async () => {
  const { 조각그리기 } = await import('../src/ui/common.js')
  const 순서 = []
  const 실패 = [
    조각그리기('가', () => { 순서.push('가') }),
    조각그리기('나', () => { 순서.push('나'); throw new ReferenceError('백업 is not defined') }),
    조각그리기('다', () => { 순서.push('다') }),
  ].filter(Boolean)

  assert.deepEqual(순서, ['가', '나', '다'], '앞이 던져도 뒤를 그려야 한다')
  assert.deepEqual(실패, ['나: 백업 is not defined'], '어느 조각이 왜 죽었는지 남아야 한다')
})

test('🔴 실패를 삼키지 않는다 — 화면과 콘솔에 남긴다', () => {
  const common = readFileSync(join(ROOT, 'src', 'ui', 'common.js'), 'utf8')
  assert.match(common, /console\.error/, '자취(stack)는 콘솔에 남겨야 한다')

  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  assert.match(app, /S\.그리기오류/, '그리기 실패를 기억해야 한다')
  assert.match(app, /화면 그리기 실패/, '신선도 줄에 적어야 한다 — 값은 새것인데 화면이 빈 수 있다')
  assert.match(app, /S\.오류 \|\| S\.그리기오류/, '그리기가 깨진 것도 점(dot)이 이상으로 보여야 한다')
})

/**
 * 🔴 조각을 **맨손으로** 부르면 이 보호가 사라진다. 한 곳이라도 빠지면
 *   그 조각이 던지는 날 화면이 다시 통째로 빈다.
 */
test('🔴 그리기() 는 모든 조각을 조각그리기로 감싼다', () => {
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  const i = app.indexOf('function 그리기()')
  const j = app.indexOf('function 신선도갱신()')
  assert.ok(i > 0 && j > i)
  const 본문 = app.slice(i, j)
  /**
   * 조각을 부르는 **줄마다** 같은 줄에 조각그리기 가 있어야 한다.
   * (목록·선택갱신은 스크롤유지 안에 있으므로 줄 단위로 봐야 맞다)
   */
  const 조각들 = ['경보그리기', '타일들', '폴더그리기', '설정그리기', '목록', '상세다시그리기']
  for (const 줄 of 본문.split('\n')) {
    if (줄.trim().startsWith("*") || 줄.trim().startsWith('//')) continue
    const 부름 = 조각들.filter((c) => new RegExp('(^|[^가-힣\\w.])' + c + '\\(').test(줄))
    if (!부름.length) continue
    assert.ok(줄.includes('조각그리기'),
      `${부름.join('·')} 을 맨손으로 부른다 — 던지면 뒤가 다 죽는다: ${줄.trim()}`)
  }
  // 이름을 붙여 부른다 — 실패 줄에 "무엇이" 죽었는지 나와야 조치할 수 있다
  const 이름들 = [...본문.matchAll(/조각그리기\('([^']+)'/g)].map((m) => m[1])
  for (const 이름 of ['계정', '경보', '요약', '폴더', 'PC 설정', '세션 목록', '상세']) {
    assert.ok(이름들.includes(이름), `${이름} 조각이 감싸여 있지 않다 (실제: ${이름들.join(', ')})`)
  }
})

/* ── 고친 코드가 화면에 반영되는가 ──────────────────────────── */

/**
 * 🔴 실측 (2026-09-22): start.ps1 -Restart 로 서버는 새 코드를 들고 떴는데,
 *   이미 열려 있던 창은 옛 모듈을 그대로 들고 폴링을 계속했다. 방금 고친 결함이
 *   화면에서는 살아 있고 아무도 경고하지 않는다. 창은 하나만 띄우는 규칙이라
 *   사람이 "닫고 다시 열기"로 풀 수도 없다 — 같은 창을 앞으로 가져온다.
 */
test('🔴 서버가 새로 떴으면 화면이 스스로 다시 읽는다', () => {
  const server = readFileSync(join(ROOT, 'src', 'ui', 'server.mjs'), 'utf8')
  const i = server.indexOf("p === '/api/ping'")
  assert.ok(i > 0)
  assert.match(server.slice(i, i + 900), /bootEpoch/, '살아있음 확인에 기동 시각을 담아야 한다')
  assert.match(server, /const 기동epoch = Date\.now\(\)/, '프로세스마다 다른 값이어야 한다')

  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  assert.match(app, /location\.reload\(\)/, '값이 바뀌면 다시 읽어야 한다')
  assert.match(app, /if \(서버기동 === null\)/, '첫 응답을 기준으로 삼아야 한다 (바로 새로고침하면 무한 반복이다)')
  assert.match(app, /pollLoop\(기동확인/, '주기적으로 확인해야 한다 (겹치지 않게)')
})

/* ── 보내다 실패하면 말해준다 ───────────────────────────────── */

/**
 * 🔴 실측 (2026-09-22): 서버가 바쁠 때 POST 가 ECONNRESET 으로 끊겼다. 보내기()에
 *   try 가 없어서 예외가 클릭 처리기 밖으로 빠져나갔고 — 화면에는 아무 일도
 *   일어나지 않는다. 사람은 단추가 안 먹었다고 생각하고 다시 누른다.
 */
test('🔴 POST 가 끊기면 조용히 넘기지 않는다', () => {
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  const i = app.indexOf('async function 보내기')
  const 구간 = app.slice(i, i + 800)
  assert.match(구간, /try \{/, 'fetch 를 감싸야 한다')
  assert.match(구간, /보내지 못했습니다/, '무엇이 안 됐는지 말해야 한다')
  assert.match(구간, /catch \(e\)/)
})

/**
 * 🔴 폴링이 겹치면 느린 서버가 더 느려진다. 앞 요청이 끝난 뒤에 다음을 잡는다.
 */
test('🔴 폴링은 겹치지 않는다 (setInterval 로 상태를 다시 읽지 않는다)', () => {
  const app = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  assert.match(app, /function pollLoop/, '끝난 뒤 다음을 잡는 고리가 있어야 한다')
  assert.match(app, /pollLoop\(상태읽기, 3000/)
  assert.match(app, /pollLoop\(상세읽기, 2000/)
  assert.ok(!/setInterval\(\(\) => \{ if \(S\.자동\)/.test(app),
    '겹치는 폴링이 남아 있으면 안 된다')
  // 신선도 갱신은 로컬 계산이라 겹칠 일이 없다 — 그것만 setInterval 로 둔다
  assert.match(app, /setInterval\(신선도갱신, 1000\)/)
})
