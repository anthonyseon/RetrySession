/**
 * ui-order.test.mjs — 시간순으로 쌓이는 탭의 **순서와 시작 위치**.
 *
 * 🔴 왜 시험이 필요한가 — 이 요구는 한 번 뒤집혔다(2026-09-28: "최신을 맨 위로" →
 *   "시간순으로, 최신을 맨 아래로"). 그런데 기존 시험은 **양쪽 다 통과**했다.
 *   순서를 아무도 재지 않으면 다음 사람이 "최신이 위가 편하지"라며 조용히 되돌린다.
 *
 * 🔴 순서를 뒤집지 않는 대신 **스크롤로** 최신을 보여준다. 둘을 함께 고정한다 —
 *   한쪽만 지키면 "시간순이지만 맨 위에서 시작"(최신을 보려면 끝까지 내려야 한다)이나
 *   "바닥에서 시작하지만 거꾸로"(대화가 거꾸로 읽힌다)가 된다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareRender, healthy } from './_ui-harness.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const { cell, S } = prepareRender()
globalThis.confirm = () => true
globalThis.alert = () => { }
const { redrawDetail } = await import('../src/ui/detail.js')

const ID = 'aaaaaaaa-1111-2222-3333-444444444444'
const session = () => ({
  sessionId: ID, shortId: 'aaaaaaaa', title: '제목', runKnown: true, running: false,
  activeMin: 60, userMsgs: 2, assistantMsgs: 2, toolCalls: 0, tokenSum: 0, costUSD: 0,
  todayKey: '2026-09-28', todayUserMsgs: 0, todayAssistantMsgs: 0, todayToolCalls: 0,
  todayTokenSum: 0, todayCostUSD: 0, byModel: {}, todayByModel: {},
  mainCwd: 'c:\\x', runCwd: 'c:\\x', registered: true, tracker: { exists: false },
  watch: { on: false, verdict: null }, restart: { on: false },
})

const draw = (tab, detail) => {
  S.state = { ...healthy(), sessions: [session()] }
  S.openSession = ID
  S.tab = tab
  S.lastDetailKey = null          // 탭을 새로 연 것으로 본다
  S.detail = {
    ok: true, item: [], progress: { openTools: [], toolRunning: false },
    activeMin: 60, bytes: 0, tailRead: 0, entryCount: 0, watchLog: [], restartLog: [], target: {},
    ...detail,
  }
  redrawDetail()
}

test('🔴 대화·도구는 시간순이다 — 오래된 것이 위, 최신이 맨 아래', () => {
  draw('tl', {
    item: [
      { kind: '사용자', at: '2026-09-28 10:00:00', label: '첫 질문' },
      { kind: '어시스턴트', at: '2026-09-28 10:00:10', label: '첫 답' },
      { kind: '사용자', at: '2026-09-28 11:00:00', label: '마지막 질문' },
    ],
  })
  const txt = cell.get('tab-tl').textContent
  assert.ok(txt.includes('첫 질문') && txt.includes('마지막 질문'), `타임라인이 안 그려졌다: ${txt}`)
  assert.ok(txt.indexOf('첫 질문') < txt.indexOf('마지막 질문'),
    '거꾸로 그려졌다 — 대화가 거꾸로 읽히면 도구 호출과 결과가 뒤바뀐다')
})

test('🔴 감시 로그는 파일에 쌓인 순서 그대로다 (뒤집지 않는다)', () => {
  draw('hb', { watchLog: ['2026-09-28 10:00:00 · 첫 줄', '2026-09-28 11:00:00 · 마지막 줄'] })
  const txt = cell.get('tab-hb').textContent
  assert.ok(txt.indexOf('첫 줄') < txt.indexOf('마지막 줄'), '감시 로그가 뒤집혔다')
})

/**
 * 🔴 재시작 로그는 한 회차가 **여러 줄 덩어리**다 — `RUN 시작` · 인자 · `RUN 끝` · 요약.
 *   줄을 뒤집으면 요약이 거꾸로 읽혀 **읽을 수 없는 기록**이 된다.
 */
test('🔴 재시작 로그의 한 회차 덩어리가 원래 순서를 지킨다', () => {
  draw('rs', {
    restartLog: [
      '2026-09-28 13:00:00 · SKIP · 조용시간',
      '═'.repeat(10),
      '2026-09-28 15:48:13 · RUN 시작 · 재개 지점 재개지시',
      '  --resume … · 권한 bypassPermissions',
      '2026-09-28 15:54:00 · RUN 끝 · ok · 206초',
      '  ── 요약 ──',
      '  첫 문단',
      '  둘째 문단',
    ],
  })
  const txt = cell.get('rsLog').textContent
  const at = (s) => txt.indexOf(s)
  assert.ok(at('SKIP · 조용시간') < at('RUN 시작'), '옛 회차가 먼저 와야 한다')
  assert.ok(at('RUN 시작') < at('RUN 끝'), '한 회차 안에서 시작이 끝보다 먼저다')
  assert.ok(at('첫 문단') < at('둘째 문단'), '요약 문단이 거꾸로 읽힌다')
})

test('🔴 순서를 안 뒤집는 대신 **바닥에서 시작**한다 (최신이 열자마자 보인다)', () => {
  const src = readFileSync(join(ROOT, 'src', 'ui', 'detail.js'), 'utf8')
  const m = /const TAIL_TABS = new Set\(\[([^\]]+)\]\)/.exec(src)
  assert.ok(m, '어느 탭이 바닥에서 시작하는지 정한 곳이 없다')
  for (const tab of ['tl', 'hb', 'rs', 'al']) {
    assert.ok(m[1].includes(`'${tab}'`), `${tab} 탭이 바닥에서 시작하지 않는다`)
  }
  assert.match(src, /toBottom: tail/, 'keepScroll 에 바닥 시작을 넘겨야 한다')
  // keepScroll 이 그 옵션을 실제로 다루는가 (이름만 넘기고 안 쓰면 조용히 안 먹는다)
  const common = readFileSync(join(ROOT, 'src', 'ui', 'common.js'), 'utf8')
  assert.match(common, /toBottom = false/, 'keepScroll 이 toBottom 을 받지 않는다')
  assert.match(common, /if \(toBottom\) \{ box\.scrollTop = box\.scrollHeight/, 'toBottom 을 받고도 쓰지 않는다')
})
