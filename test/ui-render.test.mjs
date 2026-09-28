/**
 * ui-render.test.mjs — 요약을 **실제로 그려본다.**
 *
 * 최소 DOM 과 표본은 _ui-harness.mjs 에 있다(이 파일이 400줄을 넘어 나눴다).
 * 하네스를 첫 줄에서 가져와야 한다 — 전역 DOM 을 깔고 나서 화면 모듈이 평가된다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareRender, readPs, healthy } from './_ui-harness.mjs'

/* ── 시험 ────────────────────────────────────────────────────── */

test('🔴 요약이 네 묶음으로 그려진다', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const g = readPs(h.cell)
    assert.deepEqual(g.map((x) => x.name), ['계정', '실행 중', '사용량', 'OS 트리거'])
  } finally { h.restored() }
})

test('🔴 모든 항목이 자기 묶음 안에 있다 (하나라도 빠지면 볼 곳이 없다)', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const g = readPs(h.cell)
    const where = {}
    for (const x of g) for (const [k] of x.line) where[k] = x.name

    assert.deepEqual(where, {
      '계정': '계정', '사용량 제한': '계정',
      '세션': '실행 중', 'VS Code': '실행 중', 'claude 프로세스': '실행 중',
      // 🔴 사용량은 오늘(로컬)과 누적이 **각각** 있어야 한다. 누적만 있으면
      //   "지금 얼마나 쓰고 있나"를 볼 곳이 없다.
      '오늘 토큰': '사용량', '오늘 정가': '사용량',
      '누적 토큰': '사용량', '누적 정가': '사용량',
      '감시': 'OS 트리거', '재시작': 'OS 트리거', 'UI': 'OS 트리거', '트레이': 'OS 트리거',
    })
  } finally { h.restored() }
})

test('값이 실제로 채워진다 (빈 화면이면 감시 장치가 아무것도 안 보여준다)', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const g = readPs(h.cell)
    for (const grp of g) {
      for (const [k, v] of grp.line) {
        assert.ok(v.length > 0, `'${k}' 의 값이 비었다`)
      }
    }
    const account = g[0].line
    assert.equal(account[0][1], 'a@b.c')
    assert.equal(g[1].line[0][1], '4 / 7', '세션은 "실행 중 / 전체" 다')
    // 사용량 묶음은 오늘 토큰 · 오늘 정가 · 누적 토큰 · 누적 정가 순이다
    assert.deepEqual(g[2].line.map(([, v]) => v), ['234.6K', '$1.23', '1.2M', '$4.21'],
      '오늘과 누적이 서로 다른 숫자로 그려져야 한다 — 같으면 한쪽을 안 읽은 것이다')
  } finally { h.restored() }
})

test('🔴 조회가 실패하면 0 이 아니라 ? 를 그리고 배지를 붙인다', () => {
  const h = prepareRender()
  try {
    const d = healthy()
    d.totals.runKnown = false
    d.totals.runQueryError = 'claude 없음'
    d.totals.running = 0
    h.drawTiles(d)
    const sessionRow = readPs(h.cell)[1].line[0]
    assert.ok(sessionRow[1].startsWith('? / 7'), `"0 / 7" 은 거짓말이다: ${sessionRow[1]}`)
    assert.match(sessionRow[1], /조회 실패/, '왜 모르는지 배지로 알려야 한다')
  } finally { h.restored() }
})

/**
 * 🔴 값만 있고 근거가 없으면 판단할 수 없다.
 *   "해제됨"만 보이고 언제 기록된 것인지 안 보이면 지금 상태인지 알 수 없다.
 *   "6개"만 보이고 세션/보조 구분이 없으면 많은 건지 알 수 없다.
 *   한 번 세부를 title(hover) 로만 남겼다가 "너무 심플하다"는 말을 들었다.
 */
test('🔴 항목마다 근거가 화면에 그려진다 (hover 로 숨기지 않는다)', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const g = readPs(h.cell)
    for (const grp of g) {
      grp.line.forEach(([k], i) => {
        assert.ok(grp.detailLine[i] && grp.detailLine[i].length > 0,
          `'${k}' 의 근거가 화면에 없다 — 값만 보고 판단할 수 없다`)
      })
    }
  } finally { h.restored() }
})

test('근거의 내용이 실제로 쓸모 있다 (기존 수준을 지킨다)', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const g = readPs(h.cell)
    const find = (name) => {
      for (const grp of g) {
        const i = grp.line.findIndex(([k]) => k === name)
        if (i >= 0) return grp.detailLine[i]
      }
      return null
    }
    assert.match(find('계정'), /max/, '구독 종류를 알려야 한다')
    assert.match(find('사용량 제한'), /기록/, '언제 기록된 것인지 알려야 한다 — 지금 상태가 아닐 수 있다')
    assert.match(find('세션'), /감시 2/, '감시·재시작 수가 보여야 한다')
    assert.match(find('VS Code'), /포트 1/, '창의 근거가 보여야 한다')
    assert.match(find('claude 프로세스'), /세션 1 · 보조 0/, '세션과 보조를 구별해야 한다')
    assert.match(find('누적 토큰'), /7개 세션/, '무엇의 합계인지 알려야 한다')
    assert.match(find('누적 정가'), /정가 환산 참고값/, '청구액이 아니라는 것을 말해야 한다')
    assert.match(find('오늘 토큰'), /2026-09-28|로컬/, '어느 날짜를 오늘로 셌는지 알려야 한다')
    assert.match(find('오늘 정가'), /정가 환산 참고값/, '오늘 몫도 정가 환산이다 — 청구액이 아니다')
    assert.match(find('UI'), /Running/, '작업 상태가 보여야 한다')
    assert.match(find('감시'), /마지막/, '마지막 실행 시각이 보여야 한다')
  } finally { h.restored() }
})

/**
 * 🔴 0 은 "없다"는 주장이다. 조회에 실패했을 때 우리는 그 주장을 할 수 없다.
 *   세션 줄에서 고친 것과 같은 부류가 출처마다 있었다 — 세 출처를 함께 고정한다.
 */
test('🔴 어느 출처가 실패하든 0 이 아니라 ? 를 그린다', () => {
  const cases = [
    ['세션', (d) => { d.totals.runKnown = false; d.totals.running = 0 }, /조회 실패/],
    ['VS Code', (d) => { d.ide = { windows: [], liveWindows: 0, staleLocks: 0, error: 'lock 읽기 실패' } }, /읽기 실패/],
    ['claude 프로세스', (d) => { d.processes = { ok: false, error: 'CIM 실패', items: [], sessionCount: 0, helperCount: 0, orphans: [] } }, /조회 실패/],
  ]
  for (const [name, corrupt, badgeEl] of cases) {
    const h = prepareRender()
    try {
      const d = healthy()
      corrupt(d)
      h.drawTiles(d)
      const grp = readPs(h.cell)[1]
      const i = grp.line.findIndex(([k]) => k === name)
      assert.ok(i >= 0, `${name} 줄을 찾을 수 없다`)
      const value = grp.line[i][1]
      assert.ok(value.startsWith('?'), `'${name}' 이 실패했는데 "${value}" 이라고 말한다 — 0 은 주장이다`)
      assert.match(value, badgeEl, `'${name}' 실패를 배지로 알려야 한다`)
    } finally { h.restored() }
  }
})

test('멀쩡할 때는 숫자를 그대로 말한다 (모른다고 하면 그것도 거짓말이다)', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const grp = readPs(h.cell)[1]
    assert.equal(grp.line.find(([k]) => k === 'VS Code')[1], '1개 열림')
    assert.equal(grp.line.find(([k]) => k === 'claude 프로세스')[1], '1개')
  } finally { h.restored() }
})

test('VS Code lock 폴더가 없는 것은 실패가 아니라 진짜 0 이다', () => {
  const h = prepareRender()
  try {
    const d = healthy()
    d.ide = { windows: [], liveWindows: 0, staleLocks: 0, error: null }   // 한 번도 안 띄운 PC
    h.drawTiles(d)
    const grp = readPs(h.cell)[1]
    assert.equal(grp.line.find(([k]) => k === 'VS Code')[1], '0개 열림',
      '오류가 없으면 0 은 사실이다 — 여기까지 "?" 로 만들면 아무것도 말하지 못한다')
  } finally { h.restored() }
})

test('🔴 OS 트리거는 배지로만 말하고, 긴 결과뜻은 설명으로 내린다', () => {
  const h = prepareRender()
  try {
    const d = healthy()
    d.tasks.tray = {
      name: 'T', registered: true, state: 'Ready', healthy: false, isRunning: false, stopped: true,
      resultText: '강제 종료됨(-1) — start.ps1 -Stop/-Restart 가 이렇게 끝낸다',
    }
    h.drawTiles(d)
    const grp = readPs(h.cell)[3]
    const i = grp.line.findIndex(([k]) => k === '트레이')
    assert.equal(grp.line[i][1], '■멈춰 있음', `값이 배지 하나여야 한다: ${grp.line[i][1]}`)
    assert.match(grp.desc[i], /강제 종료됨/, '긴 사정은 title 에 남아야 한다')
  } finally { h.restored() }
})

test('정상일 때도 상태를 말로 적는다 (색만으로 나르지 않는다)', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const grp = readPs(h.cell)[3]
    assert.deepEqual(grp.line.map(([, v]) => v), ['●대기', '●대기', '●도는 중', '●도는 중'])
  } finally { h.restored() }
})

test('🔴 접었을 때 남는 한 줄 요지가 채워진다', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const digest = h.cell.get('sumdigest').textContent
    assert.match(digest, /세션 4\/7/)
    assert.match(digest, /감시 2/)
    assert.match(digest, /트리거 4\/4/)
    assert.match(digest, /\$4\.21/)
  } finally { h.restored() }
})

test('요지는 제한에 걸렸을 때 그것도 말한다', () => {
  const h = prepareRender()
  try {
    const d = healthy()
    d.quota = { exists: true, alreadyLifted: false, liftInMin: 42, desc: '제한 중' }
    h.drawTiles(d)
    assert.match(h.cell.get('sumdigest').textContent, /사용량 제한 중/)
  } finally { h.restored() }
})

/* ── 시각 줄이기 (좁은 칸의 자리 다툼) ─────────────────────── */

/**
 * 🔴 요약의 좁은 칸에서 `2026-09-21 13:31:01` 은 자리를 너무 먹는다 —
 *   OS 트리거 네 줄에 시각이 여덟 개 들어가면 그것만으로 줄이 넘쳤다.
 *   초는 버리되 **다른 날이면 날짜는 남긴다.** 그 구별이 사라지면 오래된 기록을
 *   방금으로 오해하는데, 그건 이 도구가 막으라고 있는 오판이다.
 */
test('오늘 시각은 HH:MM 으로 줄인다', () => {
  const h = prepareRender()
  try {
    const t = new Date()
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    const d = healthy()
    d.tasks.UI = { ...d.tasks.UI, lastRun: `${today} 09:05:33`, nextRun: null }
    h.drawTiles(d)
    const grp = readPs(h.cell)[3]
    const i = grp.line.findIndex(([k]) => k === 'UI')
    assert.match(grp.detailLine[i], /마지막 09:05(?!:)/, `초와 날짜를 버려야 한다: ${grp.detailLine[i]}`)
  } finally { h.restored() }
})

test('🔴 다른 날이면 날짜를 남긴다 (오래된 기록을 방금으로 오해하면 안 된다)', () => {
  const h = prepareRender()
  try {
    const d = healthy()
    d.tasks.UI = { ...d.tasks.UI, lastRun: '2026-09-18 11:29:18', nextRun: null }
    h.drawTiles(d)
    const grp = readPs(h.cell)[3]
    const i = grp.line.findIndex(([k]) => k === 'UI')
    assert.match(grp.detailLine[i], /마지막 09-18 11:29/, `날짜가 사라지면 안 된다: ${grp.detailLine[i]}`)
  } finally { h.restored() }
})

test('시각이 없으면 "없음" 이라고 한다 (빈 칸은 뜻이 갈린다)', () => {
  const h = prepareRender()
  try {
    const d = healthy()
    d.tasks.UI = { ...d.tasks.UI, lastRun: null, nextRun: null }
    h.drawTiles(d)
    const grp = readPs(h.cell)[3]
    const i = grp.line.findIndex(([k]) => k === 'UI')
    assert.match(grp.detailLine[i], /마지막 없음/)
  } finally { h.restored() }
})

test('🔴 세부에 강제 줄바꿈을 넣지 않는다 — 항목마다 한 줄씩 더 먹는다', () => {
  const h = prepareRender()
  try {
    h.drawTiles(healthy())
    const grp = readPs(h.cell)[3]
    for (const [i, s] of grp.detailLine.entries()) {
      assert.ok(!s.includes('\n'),
        `'${grp.line[i][0]}' 세부에 줄바꿈이 있다 — 칸 폭에 맞춰 흐르게 두면 한 줄로 끝난다: ${JSON.stringify(s)}`)
    }
  } finally { h.restored() }
})

/* ── 무지 시험: 값이 없을 때 터지지 않는가 ──────────────────── */

test('🔴 값이 비어도 그리기가 터지지 않는다 (터지면 화면이 통째로 빈다)', () => {
  const h = prepareRender()
  try {
    // 서버가 아직 못 채운 상태를 흉내낸다
    const blank = {
      account: { ok: false }, quota: { exists: false, desc: '기록 없음' },
      tasks: {}, totals: { sessionCount: 0, running: 0, watchOn: 0, restartOn: 0, totalTokens: 0, totalUSD: 0 },
    }
    assert.doesNotThrow(() => h.drawTiles(blank))
    const g = readPs(h.cell)
    assert.equal(g.length, 4, '묶음 네 개는 그대로 있어야 한다')
    assert.equal(g[3].line.length, 0, '작업이 없으면 OS 트리거 묶음은 비어 있다')
  } finally { h.restored() }
})

test('🔴 로그인 실패·조회 실패를 각각 배지로 말한다', () => {
  const h = prepareRender()
  try {
    const d = healthy()
    d.account = { ok: false, email: null, error: '토큰 만료' }
    d.tasks.UI = { name: 'U', queryFailed: true, registered: null, error: '권한 없음' }
    d.tasks.heartbeat = { name: 'H', registered: false }
    h.drawTiles(d)
    const g = readPs(h.cell)
    assert.match(g[0].line[0][1], /확인 실패.*로그인 안 됨/s)
    const tRow = g[3].line
    assert.equal(tRow.find(([k]) => k === 'UI')[1], '▲조회 실패')
    assert.equal(tRow.find(([k]) => k === '감시')[1], '▲미등록')
  } finally { h.restored() }
})


/* ── 빈 목록이 무엇을 뜻하는지 화면이 말하는가 ───────────────── */

/**
 * 🔴 실측 (2026-09-22, 사용자 보고 두 번): 목록 자리가 통째로 비어 있었다.
 *   원인은 요약이 던져 목록이 아예 그려지지 않은 것이었는데(서버는 세션 8개를
 *   주고 있었다), 화면만 보고는 "세션이 없다"와 "목록이 고장났다"를 구별할 수
 *   없었다. 빈 자리는 아무 말도 하지 않는다.
 */
test('🔴 목록이 비면 왜 비었는지 적는다 (빈 자리와 고장을 구별해야 한다)', async () => {
  const { items } = await import(new URL('../src/ui/list.js', import.meta.url).href)
  const { S } = await import(new URL('../src/ui/common.js', import.meta.url).href)
  const h = prepareRender()
  try {
    const label = (d, onlyRegistered = false) => {
      S.onlyRegistered = onlyRegistered
      items(d)
      return h.cell.get('slist').textContent
    }
    assert.match(label({ sessions: [] }), /하나도 찾지 못했습니다/, '정말 없을 때')
    assert.match(label({ sessions: [{ sessionId: 'a', registered: false }] }, true),
      /1개를 받았지만 등록된 것이 없습니다/, '필터 때문이면 그렇게 말해야 한다')
  } finally { S.onlyRegistered = false; h.restored() }
})
