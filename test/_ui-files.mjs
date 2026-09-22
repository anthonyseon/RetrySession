/**
 * _ui-files.mjs — 화면 스크립트 목록을 **한 곳에서, 폴더에서** 읽는다.
 *
 * 🔴 왜 손으로 적지 않는가 (실측)
 *   목록이 시험 다섯 파일에 하드코딩돼 있었다. setup.js 를 새로 만들었더니
 *   ui-modules.test.mjs 의 목록에서 **빠져서** import 정합성·400줄 검사가
 *   새 파일을 아예 보지 않았다.
 *
 *   이 저장소에서 같은 부류로 이미 여러 번 다쳤다 — /api/ping 을 써야 하는
 *   .ps1 네 개 중 세 개를 놓쳤고, runhidden.exe 를 거쳐야 하는 작업 네 개 중
 *   하나를 놓쳤다. **사람은 사본을 놓친다.** 그러니 사본을 만들지 않는다.
 *
 * 부작용이 없다 — 전역 DOM 을 깔지 않으므로 어느 시험이든 마음 놓고 가져온다.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
const UI디렉터리 = join(ROOT, 'src', 'ui')

/** src/ui 의 화면 스크립트 전부 (이름순) */
export const uiModules = () => readdirSync(UI디렉터리).filter((f) => f.endsWith('.js')).sort()

/** 그 전부를 이어붙인 소스 — "화면이 X 를 한다"를 볼 때 쓴다 */
export const uiSource = () => uiModules()
  .map((f) => readFileSync(join(UI디렉터리, f), 'utf8')).join('\n')

/** 한 파일만 */
export const readUi = (f) => readFileSync(join(UI디렉터리, f), 'utf8')

/** 뼈대 */
export const HTML = () => readUi('index.html')

/**
 * 모양(CSS) — `index.html` 의 `<style>` 이든 `app.css` 든 **어디 있든** 한 벌로 본다.
 *
 * 🔴 실측 (2026-09-22): index.html 이 475줄이 되어(규칙은 400줄) CSS 를 app.css 로
 *   뺐더니, index.html 만 읽던 레이아웃 시험 **13개가 한꺼번에 깨졌다.** 규칙은
 *   "이 스타일이 있나"이지 "어느 파일에 있나"가 아니다 — 같은 부류로 또 다치지 않게
 *   여기서 합쳐 준다.
 */
export const styleSource = () => [
  HTML(),
  ...readdirSync(UI디렉터리).filter((f) => f.endsWith('.css')).sort().map((f) => readUi(f)),
].join('\n')
