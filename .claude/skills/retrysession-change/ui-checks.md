# 화면을 고쳤을 때 — 실제로 보기 · 높이 · 측정 · 🔴 규칙 바꾸기

> [`SKILL.md`](./SKILL.md) 의 §0 표(`src/ui/*`)와 §3-1 에서 가리킨다. 본문이 400줄이라
> 여기 둔다. 전부 2026-10-01 «경보 접기 · 셋까지 보이기» 회차에서 실측으로 얻은 것이다.

## 1. 🔴 하네스 통과 ≠ 화면에서 그렇게 보인다 — 실제 브라우저로 **두 크기**에서 본다

하네스(`test/_ui-harness.mjs`)에는 레이아웃이 없다 — rect 는 0 이고 CSS 는 적용되지 않는다.
높이·스크롤·줄바꿈·`display` 는 시험으로 증명되지 않는다. 서버를 `-Restart` 로 새로 띄운 뒤
헤드리스 Edge 로 찍어 **눈으로** 본다(이미지는 Read 도구로 열린다):

```powershell
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
& $edge --headless=new --disable-gpu --no-first-run --user-data-dir="$env:TEMP\rs-shot" `
  --window-size=1000,650 --force-device-scale-factor=1 --virtual-time-budget=15000 `
  --screenshot="$env:TEMP\rs-narrow.png" http://127.0.0.1:7345/
```

- 크기는 **둘**이다 — 1100px 이하(좁은 화면 규칙이 걸린다)와 그 위(앱 창 크기 1500×980).
  한쪽만 보면 다른 쪽 규칙은 안 본 것이다. 경보 상한은 **좁은 화면에서만** 풀려 있었다.
- 🔴 `--user-data-dir` 는 **임시 프로필**로 준다. 앱 창의 프로필을 쓰면 접힘 기억 같은
  localStorage 를 건드려, 사람이 다음에 연 화면이 바뀌어 있다.
- 누른 **뒤의** 모양(접기·탭)은 `--screenshot` 으로 못 본다. CDP 로 누른다 — 의존성 없이 30줄:
  `--remote-debugging-port=9333` 으로 띄우고 → `http://127.0.0.1:9333/json/list` 의 `page` 에
  node 24 의 전역 `WebSocket` 으로 붙어 → `Runtime.evaluate`(클릭 · `getComputedStyle` 읽기) →
  `Page.captureScreenshot`. 스크립트는 저장소가 아니라 **scratchpad** 에 둔다.
  - 🔴 첫 실행(새 프로필)에서 평가가 세 번 다 `undefined` 였고 원인을 못 갈랐다 — 같은
    스크립트가 두 번째부터 됐다. 붙은 대상의 **URL** 과 응답의 `exceptionDetails` 를 먼저
    찍게 하라. 그리고 첫 `/api/status` 를 기다려라(8초) — 그 전에는 그릴 것이 없다.
- 실측: 펴짐 `min(211px, 50vh)` · 경보 8건 중 3건 · 접힘 목록 `display:none` + 띠 요지 ·
  다시 펴면 다시 잰다 — 이 넷을 시험이 아니라 이 방법으로 확인했다.

## 2. 🔴 «N개까지 보인다» 를 vh 로 정하지 마라 — **재서** 정한다

- 경보 상한 `28vh` 는 높이 650px 화면에서 182px 이었고, 셋째 경보는 211px 에서 끝났다 —
  셋째가 잘렸다. 좁은 화면 규칙은 `max-height:none` 으로 상한을 **아예 풀었다**.
- 내용 길이가 제각각인 것(경보 설명)은 줄 수로도 못 센다. **그려진 N번째의 아래 끝**을 잰다
  (`src/ui/alerts.js` 의 `alertsCap` · 스크롤된 상태면 `scrollTop` 을 더한다).
- 화면 배율도 크기를 바꾼다. 이 PC 는 150%(AppliedDPI 144)다. 배율이 크면 같은 창도 CSS
  너비가 줄어 좁은 화면 규칙에 들어갈 수 있다. 사람이 본 모양을 재현하려면 그 창의
  `innerWidth`·`innerHeight` 부터 물어라 — 🔴 창 크기를 짐작으로 적지 마라(이번에 실제 앱 창은
  최소화돼 있어 재지 못했고, 그래서 «그 창이 좁은 화면이었다» 는 확인되지 않은 채 남았다).

## 3. 측정에 기대는 기능 — 0 은 «못 쟀다» 다

- 숨은 요소(접힘 · `display:none`)는 **브라우저에서도** 높이 0 으로 재어진다. 그 값을 쓰면
  상자가 몇 px 로 굳는다 → `null` 로 답하고 CSS 상한으로 물러선다(fail-safe).
  그리고 다시 잴 때를 정한다 — **펴는 순간**과 **창 크기가 바뀔 때**.
- 하네스의 `getBoundingClientRect` 는 `_rect`(기본 0)를 돌려주고 **`bottom` 이 없다** —
  `top + height` 로 계산한다. 잰 길을 시험하려면 `_rect` 를 준 뒤 **사람이 누르는 길**로
  다시 재게 한다(띠를 접었다 편다). 시험만을 위한 export 를 늘리지 않아도 된다.
- 계산은 순수 함수로 빼서 경계를 센다: N 이하 · 스크롤된 상태 · 높이 0 · NaN · 값 없음.
  🔴 그 가드를 지워 시험이 빨개지는지 확인하라(SKILL.md §3-0) — 이번에 2개가 빨개졌다.

## 4. 🔴 사용자가 CLAUDE.md 의 🔴 규칙을 바꾸라고 할 때

실측: «경보는 접히지 않는다» 가 있었는데 «다른 영역처럼 숨김/출력 단추를» 요청받았다.

1. 규칙의 **이유**를 읽는다 — «접힌 채로 '감시 끊김'이 숨으면 이 도구의 존재 이유가 사라진다».
2. 지우지 말고 **이유에 맞춰 좁힌다** — 접을 수는 있되 띠에 건수와 **치명 경보의 제목**을
   남긴다. 이유가 **시험으로** 남아야 한다(`test/ui-alerts.test.mjs`).
3. 그 선택을 사람에게 말한다 — 요청을 그대로가 아니라 **조건을 붙여** 따랐다는 것.
4. 규칙이 **적힌 곳 전부**를 같은 커밋에서 고친다. 이번에는 열한 곳이었다 — CLAUDE.md ·
   Manual.md · README.md · SKILL.md §0 표 · 코드 주석 넷(index.html · app.css · app.js ·
   summary.js) · 시험 이름 둘(ui-fold · ui-layout) · 소스 본문을 읽는 시험 하나(ui-errors —
   SKILL.md §1-2 의 그 함정이다. 옮긴 함수를 옛 파일에서 찾고 있었다).

   ```bash
   grep -rn "<옛 규칙의 핵심 문구>" --exclude-dir=state --exclude-dir=.git .
   ```

5. CLAUDE.md · Manual.md · README.md 는 이미 **400줄**이다(시험은 `split('\n')` 으로 세어
   끝 줄바꿈도 한 줄이다). 줄을 늘리지 말고 **그 자리에서** 바꿔라.
