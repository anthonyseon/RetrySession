/**
 * ui-render.test.mjs — 요약을 **실제로 그려본다.**
 *
 * 🔴 왜 이게 따로 필요한가
 *   나머지 화면 시험은 소스에 정규식을 걸어 "그렇게 쓰여 있는가"를 본다. 되돌림은
 *   막지만 **런타임 오류는 못 잡는다** — `h.총USD.toFixed` 가 undefined 인 경우,
 *   없는 묶음에 줄을 붙이는 경우, 배지 인자를 빠뜨린 경우는 모두 통과한다.
 *   그러면 화면이 빈 채로 뜨고, 감시 장치가 아무것도 안 보여주게 된다.
 *
 *   그래서 최소 DOM 을 만들어 app.js 의 요약 그리기를 정말 호출한다.
 *   브라우저를 띄우지 않으므로 의존성은 그대로 0 이다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/* ── 최소 DOM ────────────────────────────────────────────────── */

class 노드 {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this._text = '' }
  set className(v) { this.attrs.class = v }
  get className() { return this.attrs.class || '' }
  set textContent(v) { this._text = String(v); this.children = [] }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join('') }
  set title(v) { this.attrs.title = v }
  get title() { return this.attrs.title }
  append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? new 글(x) : x) }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  addEventListener() { }
  get classList() { return { toggle() { }, add() { }, remove() { }, contains: () => false } }
  querySelector() { return null }
  querySelectorAll() { return [] }
}
class 글 extends 노드 { constructor(t) { super('#text'); this._text = t } }

/** app.js 를 최소 DOM 위에서 불러 요약 그리기 함수를 꺼낸다 */
function 그리기준비() {
  const 칸 = new Map()
  const 원래 = { Node: globalThis.Node, document: globalThis.document, localStorage: globalThis.localStorage }

  globalThis.Node = 노드
  globalThis.document = {
    createElement: (t) => new 노드(t),
    createTextNode: (t) => new 글(t),
    documentElement: { dataset: {} },
    querySelector: (s) => {
      const id = s.startsWith('#') ? s.slice(1) : s
      if (!칸.has(id)) 칸.set(id, new 노드('div'))
      return 칸.get(id)
    },
    querySelectorAll: () => [],
    addEventListener: () => { },
  }
  globalThis.localStorage = { getItem: () => null, setItem: () => { } }

  const src = readFileSync(join(ROOT, 'src', 'ui', 'app.js'), 'utf8')
  // 최상위에서 도는 것들(폴링·fetch)은 막는다 — 시험이 네트워크를 건드리면 안 된다
  const 타일들 = new Function(
    'setInterval', 'setTimeout', 'fetch', 'confirm',
    `${src}\n; return 타일들`,
  )(() => 0, () => 0, () => new Promise(() => { }), () => false)

  return {
    타일들,
    칸,
    복원() { Object.assign(globalThis, 원래) },
  }
}

/** 묶음 → { 이름, 줄: [[이름, 값]] } */
const 읽기 = (칸) => 칸.get('tiles').children.map((g) => {
  const [h3, ...rows] = g.children
  return {
    이름: h3.textContent,
    줄: rows.map((r) => [r.children[0].textContent, r.children[1].textContent.trim()]),
    설명: rows.map((r) => r.title || ''),
  }
})

/* ── 표본 ────────────────────────────────────────────────────── */

const 정상 = () => ({
  at: '2026-09-21 13:00:00',
  계정: { ok: true, email: 'a@b.c', subscriptionType: 'max', authMethod: 'oauth', orgName: 'Org' },
  할당량: { 있음: true, 이미해제됨: true, 설명: '해제됨', 종류: 'unified', status: 'ok' },
  ide: { 창: [{ 살아있음: true, 포트: 1, pid: 2, workspaceFolders: ['x'] }], 살아있는창: 1, 낡은lock: 0, 폴더: [] },
  프로세스: { ok: true, 목록: [{ 출처: 'VS Code' }], 세션수: 1, 보조수: 0, 짝없음: [] },
  작업: {
    하트비트: { 이름: 'H', 등록됨: true, 상태: 'Ready', 정상: true, 돌고있음: false, 중지됨: false, 결과뜻: '성공' },
    재시작: { 이름: 'R', 등록됨: true, 상태: 'Ready', 정상: true, 돌고있음: false, 중지됨: false, 결과뜻: '성공' },
    UI: { 이름: 'U', 등록됨: true, 상태: 'Running', 정상: true, 돌고있음: true, 중지됨: false, 결과뜻: '실행 중' },
    트레이: { 이름: 'T', 등록됨: true, 상태: 'Running', 정상: true, 돌고있음: true, 중지됨: false, 결과뜻: '실행 중' },
  },
  합계: {
    세션수: 7, 실행중: 4, 실행여부앎: true, 감시켜짐: 2, 재시작켜짐: 0,
    세션없는폴더: 0, 권한우회세션: 0, 총토큰: 1234567, 총USD: 4.21, 비용해석: '정가 환산 참고값',
  },
})

/* ── 시험 ────────────────────────────────────────────────────── */

test('🔴 요약이 네 묶음으로 그려진다', () => {
  const h = 그리기준비()
  try {
    h.타일들(정상())
    const g = 읽기(h.칸)
    assert.deepEqual(g.map((x) => x.이름), ['계정', '실행 중', '사용량', 'OS 트리거'])
  } finally { h.복원() }
})

test('🔴 열 항목이 모두 자기 묶음 안에 있다 (하나라도 빠지면 볼 곳이 없다)', () => {
  const h = 그리기준비()
  try {
    h.타일들(정상())
    const g = 읽기(h.칸)
    const 어디 = {}
    for (const x of g) for (const [k] of x.줄) 어디[k] = x.이름

    assert.deepEqual(어디, {
      '계정': '계정', '사용량 제한': '계정',
      '세션': '실행 중', 'VS Code': '실행 중', 'claude 프로세스': '실행 중',
      '누적 토큰': '사용량', '정가 환산': '사용량',
      '감시': 'OS 트리거', '재시작': 'OS 트리거', 'UI': 'OS 트리거', '트레이': 'OS 트리거',
    })
  } finally { h.복원() }
})

test('값이 실제로 채워진다 (빈 화면이면 감시 장치가 아무것도 안 보여준다)', () => {
  const h = 그리기준비()
  try {
    h.타일들(정상())
    const g = 읽기(h.칸)
    for (const 묶 of g) {
      for (const [k, v] of 묶.줄) {
        assert.ok(v.length > 0, `'${k}' 의 값이 비었다`)
      }
    }
    const 계정 = g[0].줄
    assert.equal(계정[0][1], 'a@b.c')
    assert.equal(g[1].줄[0][1], '4 / 7', '세션은 "실행 중 / 전체" 다')
    assert.equal(g[2].줄[1][1], '$4.21')
  } finally { h.복원() }
})

test('🔴 조회가 실패하면 0 이 아니라 ? 를 그리고 배지를 붙인다', () => {
  const h = 그리기준비()
  try {
    const d = 정상()
    d.합계.실행여부앎 = false
    d.합계.실행여부오류 = 'claude 없음'
    d.합계.실행중 = 0
    h.타일들(d)
    const 세션줄 = 읽기(h.칸)[1].줄[0]
    assert.ok(세션줄[1].startsWith('? / 7'), `"0 / 7" 은 거짓말이다: ${세션줄[1]}`)
    assert.match(세션줄[1], /조회 실패/, '왜 모르는지 배지로 알려야 한다')
  } finally { h.복원() }
})

test('🔴 OS 트리거는 배지로만 말하고, 긴 결과뜻은 설명으로 내린다', () => {
  const h = 그리기준비()
  try {
    const d = 정상()
    d.작업.트레이 = {
      이름: 'T', 등록됨: true, 상태: 'Ready', 정상: false, 돌고있음: false, 중지됨: true,
      결과뜻: '강제 종료됨(-1) — start.ps1 -Stop/-Restart 가 이렇게 끝낸다',
    }
    h.타일들(d)
    const 묶 = 읽기(h.칸)[3]
    const i = 묶.줄.findIndex(([k]) => k === '트레이')
    assert.equal(묶.줄[i][1], '■멈춰 있음', `값이 배지 하나여야 한다: ${묶.줄[i][1]}`)
    assert.match(묶.설명[i], /강제 종료됨/, '긴 사정은 title 에 남아야 한다')
  } finally { h.복원() }
})

test('정상일 때도 상태를 말로 적는다 (색만으로 나르지 않는다)', () => {
  const h = 그리기준비()
  try {
    h.타일들(정상())
    const 묶 = 읽기(h.칸)[3]
    assert.deepEqual(묶.줄.map(([, v]) => v), ['●대기', '●대기', '●도는 중', '●도는 중'])
  } finally { h.복원() }
})

test('🔴 접었을 때 남는 한 줄 요지가 채워진다', () => {
  const h = 그리기준비()
  try {
    h.타일들(정상())
    const 요지 = h.칸.get('sumdigest').textContent
    assert.match(요지, /세션 4\/7/)
    assert.match(요지, /감시 2/)
    assert.match(요지, /트리거 4\/4/)
    assert.match(요지, /\$4\.21/)
  } finally { h.복원() }
})

test('요지는 제한에 걸렸을 때 그것도 말한다', () => {
  const h = 그리기준비()
  try {
    const d = 정상()
    d.할당량 = { 있음: true, 이미해제됨: false, 해제_남은분: 42, 설명: '제한 중' }
    h.타일들(d)
    assert.match(h.칸.get('sumdigest').textContent, /사용량 제한 중/)
  } finally { h.복원() }
})

/* ── 무지 시험: 값이 없을 때 터지지 않는가 ──────────────────── */

test('🔴 값이 비어도 그리기가 터지지 않는다 (터지면 화면이 통째로 빈다)', () => {
  const h = 그리기준비()
  try {
    // 서버가 아직 못 채운 상태를 흉내낸다
    const 빈것 = {
      계정: { ok: false }, 할당량: { 있음: false, 설명: '기록 없음' },
      작업: {}, 합계: { 세션수: 0, 실행중: 0, 감시켜짐: 0, 재시작켜짐: 0, 총토큰: 0, 총USD: 0 },
    }
    assert.doesNotThrow(() => h.타일들(빈것))
    const g = 읽기(h.칸)
    assert.equal(g.length, 4, '묶음 네 개는 그대로 있어야 한다')
    assert.equal(g[3].줄.length, 0, '작업이 없으면 OS 트리거 묶음은 비어 있다')
  } finally { h.복원() }
})

test('🔴 로그인 실패·조회 실패를 각각 배지로 말한다', () => {
  const h = 그리기준비()
  try {
    const d = 정상()
    d.계정 = { ok: false, email: null, 오류: '토큰 만료' }
    d.작업.UI = { 이름: 'U', 조회실패: true, 등록됨: null, 오류: '권한 없음' }
    d.작업.하트비트 = { 이름: 'H', 등록됨: false }
    h.타일들(d)
    const g = 읽기(h.칸)
    assert.match(g[0].줄[0][1], /확인 실패.*로그인 안 됨/s)
    const 트 = g[3].줄
    assert.equal(트.find(([k]) => k === 'UI')[1], '▲조회 실패')
    assert.equal(트.find(([k]) => k === '감시')[1], '▲미등록')
  } finally { h.복원() }
})
