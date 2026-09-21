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

