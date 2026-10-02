/**
 * _ui-harness.mjs — 화면 모듈을 **브라우저 없이 그려보기** 위한 최소 DOM.
 *
 * 🔴 왜 있나
 *   화면 시험이 전부 소스 정규식이면 런타임 오류를 못 잡는다 — 값이 undefined 라
 *   던지는 경우, 없는 묶음에 줄을 붙이는 경우는 모두 통과하고, 그러면 화면이 빈 채로
 *   뜬다. 감시 장치가 아무것도 안 보여주는 것이 가장 나쁘다.
 *   그래서 요약 그리기를 정말 호출해 본다. 브라우저를 띄우지 않으므로 의존성은 0 이다.
 *
 * 🔴 전역 DOM 은 **import 보다 먼저** 깔아야 한다.
 *   모듈은 한 번만 평가되므로 그 시점에 document 가 없으면 이후 손쓸 수 없다.
 *   이 파일이 먼저 실행되도록, 시험 파일은 이 모듈을 첫 줄에서 가져온다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
/* ── 최소 DOM ────────────────────────────────────────────────── */

class FakeNode {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this._text = ''
    // 스크롤 관련 값. 실제 브라우저에서는 레이아웃이 정하지만 시험에서는 직접 준다.
    this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0
    /**
     * 🔴 너비와 위치도 준다. 배치(스플리터)는 **그릇 너비를 알아야** 자를 수 있고,
     *   모르면 잘못 잘라 한쪽이 사라진다. 시험이 그 경계를 짚으려면 여기 있어야 한다.
     *   실제 브라우저에서는 레이아웃이 정하지만 시험에서는 직접 준다.
     */
    this.clientWidth = 0
    this._rect = { left: 0, top: 0, width: 0, height: 0 }
    /**
     * 🔴 dataset·style·value 가 없으면 **그려보는 시험 자체가 불가능하다.**
     *   setup.js 는 `sel.dataset.key = …` 와 `sm.style.cursor = …` 를 쓴다.
     *   없는 것에 대입하면 TypeError 이고, 브라우저에서는 그 순간 모달이 빈 채로 뜬다.
     *   그래서 여기 둔다 — 시험이 잡아야 하는 게 바로 그 부류의 사고다.
     */
    this.dataset = {}; this.style = {}; this.value = undefined
  }
  set className(v) { this.attrs.class = v }
  get className() { return this.attrs.class || '' }
  set textContent(v) { this._text = String(v); this.children = [] }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join('') }
  set title(v) { this.attrs.title = v }
  get title() { return this.attrs.title }
  append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? new label(x) : x) }
  getBoundingClientRect() { return { ...this._rect } }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  addEventListener(kind, fn) { (this._on ||= {})[kind] = fn }
  /** 시험에서 사건을 흉내낸다 — 사람이 드롭다운을 고른 것과 같은 경로를 탄다 */
  fire(kind) { this._on?.[kind]?.({ target: this }) }
  /**
   * 🔴 classList 를 **진짜로** 움직인다.
   *
   *   예전에는 아무것도 하지 않는 껍데기였다(`toggle() {}`). 그래서 접기·펴기처럼
   *   **클래스로만 표현되는 상태**는 시험해도 늘 통과했다 — 실측: 묶음 접기를 눌러도
   *   `aria-expanded` 만 바뀌고 `folded` 클래스는 확인할 방법이 없었다.
   *   감시 장치의 시험이 "그럴 것이다"로 넘어가면 시험이 아니다.
   */
  get classList() {
    const self = this
    const set = () => new Set(String(self.attrs.class || '').split(/\s+/).filter(Boolean))
    const put = (s) => { self.attrs.class = [...s].join(' ') }
    return {
      add(...cs) { const s = set(); for (const c of cs) s.add(c); put(s) },
      remove(...cs) { const s = set(); for (const c of cs) s.delete(c); put(s) },
      contains: (c) => set().has(c),
      toggle(c, force) {
        const s = set()
        const on = force === undefined ? !s.has(c) : !!force
        if (on) s.add(c); else s.delete(c)
        put(s)
        return on
      },
    }
  }
  /** `select.pcsel` · `.pcsel` · `select` 만 안다 — 그 이상은 시험에 필요 없다 */
  querySelectorAll(selector) {
    const [t, c] = String(selector).split('.')
    const matches = (n) => (!t || n.tag === t) && (!c || String(n.className).split(/\s+/).includes(c))
    const collected = []
    const walk = (n) => { for (const ch of n.children) { if (matches(ch)) collected.push(ch); walk(ch) } }
    walk(this)
    return collected
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
}
class label extends FakeNode { constructor(t) { super('#text'); this._text = t } }

/**
 * 최소 DOM 을 전역에 깔아둔다. **import 보다 먼저** 해야 한다 —
 * 모듈은 한 번만 평가되므로, 그 시점에 document 가 없으면 이후 손쓸 수 없다.
 *
 * 🔴 app.js 를 불러오면 폴링과 이벤트 바인딩이 함께 돈다. 그래서 **summary.js 만**
 *   가져온다. app.js 를 조각으로 나눈 덕에 그릴 것만 따로 시험할 수 있게 됐다 —
 *   예전에는 new Function 으로 app.js 전체를 감싸 setInterval·fetch 를 가짜로
 *   넘겨야 했다.
 */
const cell = new Map()
globalThis.Node = FakeNode
globalThis.document = {
  createElement: (t) => new FakeNode(t),
  createTextNode: (t) => new label(t),
  documentElement: { dataset: {} },
  querySelector: (s) => {
    const id = s.startsWith('#') ? s.slice(1) : s
    if (!cell.has(id)) cell.set(id, new FakeNode('div'))
    return cell.get(id)
  },
  querySelectorAll: () => [],
  addEventListener: () => { },
}
/**
 * 🔴 localStorage 도 **진짜로** 기억한다.
 *   `getItem: () => null` 이던 껍데기 때문에 "접어 두면 다음 렌더에도 접혀 있다"를
 *   시험할 수 없었다 — 눌러도 상태가 안 남으니 다시 그리면 늘 펴진 모습이었다.
 *   기억하는 것이 이 기능의 요점인데 그 요점만 시험에서 빠져 있었다.
 */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
  clear: () => store.clear(),
}

const UI = (f) => import(pathToFileURL(join(ROOT, 'src', 'ui', f)).href)
const { drawTiles } = await UI('summary.js')
/**
 * setup.js 도 함께 가져온다 — 부작용이 없다(폴링·바인딩은 app.js 에 있다).
 * PC 설정 모달은 **남의 PC 전원 설정을 바꾸는 화면**이다. 소스 정규식만으로
 * 시험하면 그려보지 않은 코드가 남고, 그 코드가 사고를 낸다.
 */
const config = await UI('setup.js')
const { S } = await UI('common.js')

/** 시험마다 화면을 비운다 (모듈은 한 번만 평가되므로 칸만 갈아준다) */
export function prepareRender() {
  cell.clear()
  S.state = null
  // 🔴 기억해 둔 접힘 상태도 비운다 — 앞 시험이 접어 둔 것을 물려받으면
  //   "처음에는 펴져 있다"를 시험할 수 없다.
  store.clear()
  config.clearChosen()   // 지난 시험에서 고른 값·지문을 물려받지 않는다
  return { drawTiles, cell, S, config, restored() { /* 전역 DOM 은 파일 전체에서 공유한다 */ } }
}

/**
 * 묶음 → { 이름, 줄: [[이름, 값]], 세부: [보이는 세부 줄] }
 *
 * `세부` 는 **화면에 그려진** 것만 읽는다(.gd). title 은 따로 본다 —
 * 그래야 "세부가 보인다"와 "title 에만 있다"를 구별할 수 있다.
 */
export const readPs = (cell) => cell.get('tiles').children.map((g) => {
  const [h3, ...rows] = g.children
  const findCell = (r, cls) => r.children.find((c) => c.className === cls) || null
  return {
    name: h3.textContent,
    line: rows.map((r) => {
      const top = findCell(r, 'gtop')
      return [top.children[0].textContent, top.children[1].textContent.trim()]
    }),
    detailLine: rows.map((r) => findCell(r, 'gd')?.textContent ?? null),
    desc: rows.map((r) => r.title || ''),
  }
})

/* ── 표본 ────────────────────────────────────────────────────── */

export const healthy = () => ({
  at: '2026-09-21 13:00:00',
  account: { ok: true, email: 'a@b.c', subscriptionType: 'max', authMethod: 'oauth', orgName: 'Org' },
  quota: { exists: true, alreadyLifted: true, desc: '해제됨', kind: 'unified', status: 'ok' },
  ide: { windows: [{ alive: true, port: 1, pid: 2, workspaceFolders: ['x'] }], liveWindows: 1, staleLocks: 0, folders: [] },
  processes: { ok: true, items: [{ source: 'VS Code' }], sessionCount: 1, helperCount: 0, orphans: [] },
  tasks: {
    heartbeat: { name: 'H', registered: true, state: 'Ready', healthy: true, isRunning: false, stopped: false, resultText: '성공' },
    restart: { name: 'R', registered: true, state: 'Ready', healthy: true, isRunning: false, stopped: false, resultText: '성공' },
    UI: { name: 'U', registered: true, state: 'Running', healthy: true, isRunning: true, stopped: false, resultText: '실행 중' },
    tray: { name: 'T', registered: true, state: 'Running', healthy: true, isRunning: true, stopped: false, resultText: '실행 중' },
  },
  totals: {
    sessionCount: 7, running: 4, runKnown: true, watchOn: 2, restartOn: 0,
    foldersNoSession: 0, bypassSessions: 0, totalTokens: 1234567, totalUSD: 4.21, costNote: '정가 환산 참고값',
    // 오늘 몫은 누적보다 **작아야** 한다 — 두 숫자가 갈렸는지 시험이 보려면 달라야 한다
    todayTokens: 234567, todayUSD: 1.23, todayKey: '2026-09-28',
  },
})

