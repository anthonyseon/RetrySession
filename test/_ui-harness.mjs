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

class 노드 {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this._text = ''
    // 스크롤 관련 값. 실제 브라우저에서는 레이아웃이 정하지만 시험에서는 직접 준다.
    this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0
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
  append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? new 글(x) : x) }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  addEventListener(종류, fn) { (this._on ||= {})[종류] = fn }
  /** 시험에서 사건을 흉내낸다 — 사람이 드롭다운을 고른 것과 같은 경로를 탄다 */
  발생(종류) { this._on?.[종류]?.({ target: this }) }
  get classList() { return { toggle() { }, add() { }, remove() { }, contains: () => false } }
  /** `select.pcsel` · `.pcsel` · `select` 만 안다 — 그 이상은 시험에 필요 없다 */
  querySelectorAll(선택자) {
    const [t, c] = String(선택자).split('.')
    const 맞나 = (n) => (!t || n.tag === t) && (!c || String(n.className).split(/\s+/).includes(c))
    const 모음 = []
    const 훑기 = (n) => { for (const ch of n.children) { if (맞나(ch)) 모음.push(ch); 훑기(ch) } }
    훑기(this)
    return 모음
  }
  querySelector(선택자) { return this.querySelectorAll(선택자)[0] ?? null }
}
class 글 extends 노드 { constructor(t) { super('#text'); this._text = t } }

/**
 * 최소 DOM 을 전역에 깔아둔다. **import 보다 먼저** 해야 한다 —
 * 모듈은 한 번만 평가되므로, 그 시점에 document 가 없으면 이후 손쓸 수 없다.
 *
 * 🔴 app.js 를 불러오면 폴링과 이벤트 바인딩이 함께 돈다. 그래서 **summary.js 만**
 *   가져온다. app.js 를 조각으로 나눈 덕에 그릴 것만 따로 시험할 수 있게 됐다 —
 *   예전에는 new Function 으로 app.js 전체를 감싸 setInterval·fetch 를 가짜로
 *   넘겨야 했다.
 */
const 칸 = new Map()
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

const UI = (f) => import(pathToFileURL(join(ROOT, 'src', 'ui', f)).href)
const { drawTiles } = await UI('summary.js')
/**
 * setup.js 도 함께 가져온다 — 부작용이 없다(폴링·바인딩은 app.js 에 있다).
 * PC 설정 모달은 **남의 PC 전원 설정을 바꾸는 화면**이다. 소스 정규식만으로
 * 시험하면 그려보지 않은 코드가 남고, 그 코드가 사고를 낸다.
 */
const 설정 = await UI('setup.js')
const { S } = await UI('common.js')

/** 시험마다 화면을 비운다 (모듈은 한 번만 평가되므로 칸만 갈아준다) */
export function prepareRender() {
  칸.clear()
  S.상태 = null
  설정.clearChosen()   // 지난 시험에서 고른 값·지문을 물려받지 않는다
  return { drawTiles, 칸, S, 설정, 복원() { /* 전역 DOM 은 파일 전체에서 공유한다 */ } }
}

/**
 * 묶음 → { 이름, 줄: [[이름, 값]], 세부: [보이는 세부 줄] }
 *
 * `세부` 는 **화면에 그려진** 것만 읽는다(.gd). title 은 따로 본다 —
 * 그래야 "세부가 보인다"와 "title 에만 있다"를 구별할 수 있다.
 */
export const 읽기 = (칸) => 칸.get('tiles').children.map((g) => {
  const [h3, ...rows] = g.children
  const findCell = (r, cls) => r.children.find((c) => c.className === cls) || null
  return {
    이름: h3.textContent,
    줄: rows.map((r) => {
      const top = findCell(r, 'gtop')
      return [top.children[0].textContent, top.children[1].textContent.trim()]
    }),
    세부: rows.map((r) => findCell(r, 'gd')?.textContent ?? null),
    설명: rows.map((r) => r.title || ''),
  }
})

/* ── 표본 ────────────────────────────────────────────────────── */

export const 정상 = () => ({
  at: '2026-09-21 13:00:00',
  계정: { ok: true, email: 'a@b.c', subscriptionType: 'max', authMethod: 'oauth', orgName: 'Org' },
  할당량: { 있음: true, 이미해제됨: true, 설명: '해제됨', 종류: 'unified', status: 'ok' },
  ide: { 창: [{ 살아있음: true, 포트: 1, pid: 2, workspaceFolders: ['x'] }], 살아있는창: 1, 낡은lock: 0, 폴더: [] },
  프로세스: { ok: true, 목록: [{ 출처: 'VS Code' }], 세션수: 1, 보조수: 0, 짝없음: [] },
  작업: {
    하트비트: { 이름: 'H', 등록됨: true, 상태: 'Ready', 정상: true, 돌고있음: false, 중지됨: false, resultText: '성공' },
    재시작: { 이름: 'R', 등록됨: true, 상태: 'Ready', 정상: true, 돌고있음: false, 중지됨: false, resultText: '성공' },
    UI: { 이름: 'U', 등록됨: true, 상태: 'Running', 정상: true, 돌고있음: true, 중지됨: false, resultText: '실행 중' },
    트레이: { 이름: 'T', 등록됨: true, 상태: 'Running', 정상: true, 돌고있음: true, 중지됨: false, resultText: '실행 중' },
  },
  합계: {
    세션수: 7, 실행중: 4, 실행여부앎: true, 감시켜짐: 2, 재시작켜짐: 0,
    세션없는폴더: 0, 권한우회세션: 0, 총토큰: 1234567, 총USD: 4.21, 비용해석: '정가 환산 참고값',
  },
})

