/**
 * usage-today.test.mjs — 사용량을 **오늘(로컬)과 누적으로** 가른 것을 고정한다.
 *
 * 🔴 여기서 틀리면 조용히 거짓 숫자가 남는다. "오늘 얼마나 썼나"는 사람이 가장 자주
 *   묻는 것인데, 틀려도 화면은 멀쩡해 보인다 — 누구도 손으로 검산하지 않는다.
 *   그래서 **틀릴 수 있는 세 자리**를 각각 고정한다:
 *     ① 로컬 자정 기준인가 (UTC 로 세면 Asia/Seoul 에서 하루 중 9시간을 어제로 센다)
 *     ② 자정을 넘기면 0 으로 돌아가나 (파일이 자라지 않아도)
 *     ③ 시각 없는·거꾸로 온 엔트리가 오늘 몫을 부풀리거나 지우지 않나
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyTotals, foldEntry, foldLines, todayView, sumTokens } from '../src/lib/session-fold.mjs'
import { dayKey } from '../src/lib/stamp.mjs'

/** 어시스턴트 발화 하나 — 토큰은 입력 n, 출력 n 으로 단순하게 */
const say = (iso, n = 10, model = 'claude-opus-5') => ({
  type: 'assistant', timestamp: iso,
  message: { model, usage: { input_tokens: n, output_tokens: n }, content: [{ type: 'tool_use' }] },
})
const ask = (iso) => ({ type: 'user', timestamp: iso })

/** 로컬 시각으로 ISO 문자열을 만든다 — 시험이 어느 시간대에서도 같게 돌아야 한다 */
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString()

test('오늘 몫과 누적이 각각 쌓인다', () => {
  const acc = emptyTotals('s', 'slug')
  const today = dayKey()
  const now = new Date()
  foldEntry(acc, ask(now.toISOString()))
  foldEntry(acc, say(now.toISOString(), 10))
  foldEntry(acc, say(now.toISOString(), 5))

  assert.equal(acc.userMsgs, 1)
  assert.equal(sumTokens(acc.byModel), 30, '누적은 입력+출력 = (10+10)+(5+5)')
  const v = todayView(acc, today)
  assert.equal(v.tokenSum, 30, '오늘 안에 다 일어났으므로 누적과 같다')
  assert.equal(v.userMsgs, 1)
  assert.equal(v.assistantMsgs, 2)
  assert.equal(v.toolCalls, 2)
})

/**
 * 🔴 이것이 이 기능의 핵심이다 — 어제 것이 오늘로 새면 숫자가 거짓이 된다.
 */
test('🔴 어제 것은 오늘 몫에 들어가지 않는다', () => {
  const acc = emptyTotals('s', 'slug')
  foldEntry(acc, say(at(2026, 9, 27, 23, 50), 100))   // 어제 늦게
  foldEntry(acc, say(at(2026, 9, 28, 0, 10), 7))      // 자정을 넘겨서
  assert.equal(sumTokens(acc.byModel), 214, '누적은 둘 다 담는다 (200 + 14)')
  const v = todayView(acc, '2026-09-28')
  assert.equal(v.tokenSum, 14, '오늘 몫은 자정 뒤의 것만이다')
  assert.equal(v.assistantMsgs, 1)
})

test('🔴 자정을 넘기면 파일이 자라지 않아도 0 으로 돌아간다', () => {
  const acc = emptyTotals('s', 'slug')
  foldEntry(acc, say(at(2026, 9, 28, 14, 0), 50))
  assert.equal(todayView(acc, '2026-09-28').tokenSum, 100, '그날은 담겨 있다')
  // 하루가 지났다. 캐시에는 어제 통이 그대로 남아 있지만 **읽는 쪽이** 0 으로 답해야 한다
  const v = todayView(acc, '2026-09-29')
  assert.equal(v.tokenSum, 0, '어제 쓴 것을 오늘 것이라 말하면 거짓이다')
  assert.deepEqual(v.byModel, {})
  assert.equal(v.userMsgs, 0)
  assert.equal(v.toolCalls, 0)
  assert.equal(v.day, '2026-09-29', '어느 날짜로 답했는지 밝힌다')
})

test('🔴 로컬 자정으로 가른다 (UTC 가 아니다)', () => {
  /**
   * 실측 함정(이 저장소가 이미 밟았다 — guard.recordRun): `toISOString().slice(0,10)` 은
   * UTC 라서 Asia/Seoul(+9) 에서는 **오늘 00:00~08:59 가 어제로 세어진다.**
   * 지금 시간대의 오늘 이른 아침을 넣어, 로컬로 세는지 본다.
   */
  const acc = emptyTotals('s', 'slug')
  const today = new Date()
  const early = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 3, 30)
  foldEntry(acc, say(early.toISOString(), 11))
  const v = todayView(acc, dayKey())
  assert.equal(v.tokenSum, 22, '로컬 오늘 새벽 3:30 은 오늘이다 — UTC 로 세면 0 이 된다')
  assert.equal(acc.day, dayKey(early), 'acc.day 도 로컬 날짜여야 한다')
})

test('시각이 없는 엔트리는 오늘로 세지 않는다 (모르는 것을 오늘로 몰면 부푼다)', () => {
  const acc = emptyTotals('s', 'slug')
  const now = new Date().toISOString()
  foldEntry(acc, say(now, 10))
  foldEntry(acc, { type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 999, output_tokens: 999 } } })
  assert.equal(sumTokens(acc.byModel), 2018, '누적에는 담는다 — 일어난 일이다')
  assert.equal(todayView(acc, dayKey()).tokenSum, 20, '시각을 모르는 것은 오늘 몫이 아니다')
})

test('🔴 거꾸로 온 옛 엔트리가 오늘 몫을 지우지 않는다', () => {
  const acc = emptyTotals('s', 'slug')
  foldEntry(acc, say(at(2026, 9, 28, 10, 0), 30))
  foldEntry(acc, say(at(2026, 9, 27, 10, 0), 40))   // 시간순이 아닌 줄 하나
  const v = todayView(acc, '2026-09-28')
  assert.equal(v.tokenSum, 60, '옛 줄 때문에 통이 어제로 바뀌면 오늘 몫이 사라진다')
  assert.equal(acc.day, '2026-09-28')
  assert.equal(sumTokens(acc.byModel), 140, '누적에는 둘 다 담긴다')
})

test('모델별 오늘 몫이 따로 남는다 (무엇을 오늘 태우고 있나)', () => {
  const acc = emptyTotals('s', 'slug')
  foldEntry(acc, say(at(2026, 9, 27, 10, 0), 50, 'claude-haiku-4-5-20251001'))
  foldEntry(acc, say(at(2026, 9, 28, 10, 0), 20, 'claude-opus-5'))
  const v = todayView(acc, '2026-09-28')
  assert.deepEqual(Object.keys(v.byModel), ['claude-opus-5'], '오늘 쓴 모델만 있어야 한다')
  assert.deepEqual(Object.keys(acc.byModel).sort(), ['claude-haiku-4-5-20251001', 'claude-opus-5'])
})

test('누적과 오늘이 같은 값을 접는다 (한쪽만 고치면 어긋난다)', () => {
  const acc = emptyTotals('s', 'slug')
  const now = new Date().toISOString()
  foldEntry(acc, {
    type: 'assistant', timestamp: now,
    message: {
      model: 'claude-opus-5',
      usage: {
        input_tokens: 3, output_tokens: 5, cache_read_input_tokens: 7,
        cache_creation: { ephemeral_5m_input_tokens: 11, ephemeral_1h_input_tokens: 13 },
      },
    },
  })
  const t = acc.byModel['claude-opus-5']
  assert.deepEqual(todayView(acc, dayKey()).byModel['claude-opus-5'], t,
    '오늘 통과 누적 통의 칸 값이 같아야 한다')
  assert.equal(sumTokens(acc.byModel), 3 + 5 + 7 + 11 + 13)
})

/* ── 불변식: 오늘 ≤ 누적 ─────────────────────────────────────── */

/**
 * 🔴 **오늘 사용량은 누적 사용량의 "이하"여야 한다.** 다섯 항목 모두.
 *
 *   오늘 몫은 누적의 **부분집합**이므로 구조적으로 그래야 한다 — 같은 값을 두 통에
 *   접고, 오늘 통에만 날짜 조건이 붙는다. 그런데 이 성질이 깨지면 화면은 멀쩡해
 *   보이고(둘 다 그럴듯한 숫자다) 아무도 손으로 검산하지 않는다. 그래서 못박는다.
 *
 *   첫날이면 **같고**, 이틀 이상 걸쳐 썼으면 오늘이 **더 적다.**
 */
const measures = (acc, today) => {
  const v = todayView(acc, today)
  return {
    today: [v.tokenSum, v.userMsgs, v.assistantMsgs, v.toolCalls],
    total: [sumTokens(acc.byModel), acc.userMsgs, acc.assistantMsgs, acc.toolCalls],
  }
}

test('🔴 첫날이면 오늘과 누적이 같다', () => {
  const acc = emptyTotals('s', 'slug')
  for (const h of [1, 9, 13, 23]) foldEntry(acc, say(at(2026, 9, 28, h), 10))
  foldEntry(acc, ask(at(2026, 9, 28, 13, 30)))
  const m = measures(acc, '2026-09-28')
  assert.deepEqual(m.today, m.total, '하루만 썼으면 오늘이 곧 전부다')
})

test('🔴 이틀 이상 걸쳐 썼으면 오늘이 누적보다 적다', () => {
  const acc = emptyTotals('s', 'slug')
  for (const d of [25, 26, 27]) { foldEntry(acc, ask(at(2026, 9, d, 10))); foldEntry(acc, say(at(2026, 9, d, 11), 10)) }
  foldEntry(acc, ask(at(2026, 9, 28, 10)))
  foldEntry(acc, say(at(2026, 9, 28, 11), 10))
  const m = measures(acc, '2026-09-28')
  for (let i = 0; i < m.today.length; i++) {
    assert.ok(m.today[i] < m.total[i], `항목 ${i}: 오늘 ${m.today[i]} 이 누적 ${m.total[i]} 보다 적어야 한다`)
  }
})

test('🔴 어떤 순서로 접어도 오늘 ≤ 누적 이다 (거꾸로 온 줄·시각 없는 줄 섞어서)', () => {
  const acc = emptyTotals('s', 'slug')
  const entries = [
    say(at(2026, 9, 26, 9), 3), ask(at(2026, 9, 28, 1)), say(at(2026, 9, 28, 2), 4),
    { type: 'assistant', message: { model: 'claude-opus-5', usage: { input_tokens: 5, output_tokens: 5 } } },
    say(at(2026, 9, 27, 23), 6), ask(at(2026, 9, 28, 3)), say(at(2026, 9, 28, 4), 7),
    say(at(2026, 9, 29, 0, 5), 8), say(at(2026, 9, 28, 23, 59), 9),
  ]
  for (const e of entries) {
    foldEntry(acc, e)
    // 접는 **매 걸음마다** 성립해야 한다 — 마지막에만 맞는 것은 우연일 수 있다
    for (const day of ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30']) {
      const m = measures(acc, day)
      for (let i = 0; i < m.today.length; i++) {
        assert.ok(m.today[i] <= m.total[i],
          `${day} 항목 ${i}: 오늘 ${m.today[i]} > 누적 ${m.total[i]} — 부분집합이 전체보다 클 수 없다`)
      }
    }
  }
})

/* ── 증분 스캔이 전량 읽기와 같은 답을 내는가 ─────────────────── */

/**
 * 🔴 실제 스캔은 **자란 부분만** 읽고, 누적을 JSON 으로 캐시에 저장했다가 다음 회차가
 *   이어서 쓴다. 그래서 "한 번에 다 읽었을 때"와 답이 같아야 한다 — 다르면 오늘 몫이
 *   회차마다 달라지는데, 화면은 둘 중 아무 값이나 그럴듯하게 보여준다.
 *
 *   실측(2026-09-28): 캐시 경로와 전량 재읽기를 살아 있는 세션에서 비교했더니 6칸이
 *   어긋났다. 원인은 **두 스캔 사이에 트랜스크립트가 자란 것**이었다(연속 두 번 전량
 *   읽기는 같았고, 파일이 조용할 때 다시 재면 0 칸이었다). 살아 있는 파일로는 이것을
 *   가릴 수 없으므로 — 여기서 입력을 **고정해** 같은 성질을 시험한다.
 */
const line = (o) => JSON.stringify(o) + '\n'

test('🔴 나눠 읽어도 한 번에 읽은 것과 같다 (캐시 왕복까지 포함)', () => {
  const text = [
    line(say(at(2026, 9, 27, 22), 3)),
    line(ask(at(2026, 9, 27, 23))),
    line(say(at(2026, 9, 28, 1), 5)),
    line(ask(at(2026, 9, 28, 2))),
    line(say(at(2026, 9, 28, 3), 7)),
  ].join('')

  const whole = foldLines(emptyTotals('s', 'g'), text)

  // 줄 경계에서 자른다 — readPs 가 미완성 줄을 남기므로 실제로도 항상 줄 경계다
  const cut = text.indexOf('\n', text.indexOf('\n') + 1) + 1
  let part = foldLines(emptyTotals('s', 'g'), text.slice(0, cut))
  // 🔴 캐시를 거친다 — 여기서 잃는 값이 있으면(Map·undefined 등) 이 왕복에서 드러난다
  part = JSON.parse(JSON.stringify(part))
  part = foldLines(part, text.slice(cut))

  for (const day of ['2026-09-27', '2026-09-28', '2026-09-29']) {
    assert.deepEqual(measures(part, day), measures(whole, day), `${day} 기준으로 답이 달라졌다`)
  }
  assert.equal(part.day, whole.day)
  assert.deepEqual(part.dayByModel, whole.dayByModel)
})

test('🔴 날짜가 조각 경계에서 넘어가도 오늘 몫이 맞다', () => {
  // 조각 1 = 어제까지, 조각 2 = 오늘 — 캐시를 물려받은 다음 회차가 이 모양이다
  const y = [line(say(at(2026, 9, 27, 10), 100)), line(say(at(2026, 9, 27, 20), 100))].join('')
  const t = [line(say(at(2026, 9, 28, 9), 4))].join('')
  let acc = foldLines(emptyTotals('s', 'g'), y)
  assert.equal(todayView(acc, '2026-09-28').tokenSum, 0, '아직 오늘 것이 없다')
  acc = foldLines(JSON.parse(JSON.stringify(acc)), t)
  assert.equal(todayView(acc, '2026-09-28').tokenSum, 8, '오늘 조각만 담겨야 한다')
  assert.equal(sumTokens(acc.byModel), 408, '누적은 어제 것을 잃지 않는다')
})

test('빈 누적·옛 캐시 모양에도 터지지 않는다', () => {
  assert.equal(todayView(emptyTotals('s', 'g'), dayKey()).tokenSum, 0)
  assert.equal(todayView({}, dayKey()).tokenSum, 0, '오늘 칸이 없는 옛 캐시')
  assert.equal(todayView(null, dayKey()).tokenSum, 0)
  assert.equal(sumTokens(undefined), 0)
})
