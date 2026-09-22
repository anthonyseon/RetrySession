---
name: retrysession-change
description: RetrySession(세션 감시·재시작 도구)의 코드·스크립트·예약 작업을 고칠 때 쓰는 절차. src/·scripts/·tools/ 를 수정하거나, 예약 작업을 등록·재등록하거나, UI·트레이·start.exe 를 바꿀 때 사용한다. 고치고 나서 "왜 반영이 안 되지", "왜 콘솔 창이 뜨지", "왜 .ps1 이 안 돌지" 를 겪지 않게 하는 검증 순서를 담았다.
---

# RetrySession 을 고칠 때

이 저장소는 **감시 장치**다. 틀리면 사람이 "괜찮다"고 믿는 동안 일이 멈춰 있다.
아래는 취향이 아니라 **이 저장소를 만들며 실제로 밟은 함정**들이다. 순서대로 하라.

불변 규칙 자체는 [`CLAUDE.md`](../../../CLAUDE.md) 에 있다. 여기는 **절차**다.

## 0. 고치기 전에 — 무엇을 건드리는지 확인

| 건드리는 것 | 반드시 함께 볼 것 |
|---|---|
| `src/lib/guard.mjs` · 판정 로직 | fail-closed 유지 · "모를 때"의 시험을 함께 쓴다 |
| `scripts/*.ps1` · `start.ps1` | **순수 ASCII** — 한글·이모지 금지 |
| 예약 작업 등록 | action 은 `runhidden.exe` 경유 (콘솔 창) |
| `src/ui/*` | 고쳐도 **자동 반영되지 않는다** (아래 2번) |
| `tray.ps1` | `ShowBalloonTip` 금지 · `/api/tray` 만 읽는다 · **UI 스레드를 붙잡지 마라** |
| 프로세스를 띄우는 코드 | `shell: needsShell(exe)` — 무조건 `shell:true` 금지 |
| 상태 파일을 쓰는 코드 | `lib/io.mjs` 의 `원자쓰기`/`덧붙이기` — `writeFileSync` 직접 금지 |
| 락을 만드는 코드 | `{ flag: 'wx' }` — 보고-쓰기는 둘 다 통과시킨다 |
| `src/ui/server.mjs` 의 라우팅 | 새 엔드포인트도 `출처괜찮나`·`세션id인가` 를 거친다 |
| 화면 상단 영역 | 경보(`.alerts-wrap`)를 접히는 `#top` 안으로 옮기지 마라 |

## 1. 고친다

주석은 **왜**를 적는다. 실측 근거가 있으면 수치와 날짜를 남겨라 —
이 저장소의 제약은 대부분 사고에서 왔고, 근거가 없으면 다음 사람이 되돌린다.

순수 판정 함수는 IO 와 분리해 둔다. 그래야 시험할 수 있다.

## 2. 🔴 반영시킨다 — 가장 많이 걸린 함정

```powershell
.\start.ps1 -Restart        # 또는 .\start.exe -Restart
```

**그냥 실행하면 반영되지 않는다.** 서버가 "이미 떠 있음"으로 넘어가는데, 살아 있는
node 프로세스는 **기동 시점의 모듈**을 들고 있다. 화면은 옛 동작을 계속 보여주고
아무도 경고하지 않는다. 이 저장소를 만드는 동안 두 번 걸렸다.

`.ps1` 이나 `tools/*.cs` 를 고쳤다면 exe 부터 다시 만든다:

```powershell
.\scripts\build-exe.ps1     # start.exe + runhidden.exe
```

예약 작업의 action·설정을 고쳤다면 **재등록**해야 한다. 단순 재시작으로는 안 바뀐다:

```powershell
.\scripts\register-ui.ps1        # 포트를 먼저 비우고 등록 후 응답까지 확인한다
.\scripts\register-heartbeat.ps1
.\scripts\register-resume.ps1
.\scripts\register-tray.ps1
```

## 3. 시험한다

```bash
npm test        # node --test test/*.test.mjs
```

ASCII 가드가 가장 자주 잡는다(`.ps1` 의 한글·이모지). 이 저장소를 만드는 동안
**세 번** 걸렸다 — 사람 손을 믿지 마라. 실패하면 비ASCII 줄 번호를 알려준다.

새 판정 로직을 넣었으면 **"모를 때"의 시험을 반드시 함께** 쓴다:
값이 없을 때 · 파일이 깨졌을 때 · 프로세스가 죽었을 때 각각 "안 된다"로 답해야 한다.

## 4. 검증한다 — "등록됨"과 "돌고 있음"은 다르다

```powershell
.\start.exe -Status
```

네 가지를 각각 확인하라. 하나만 보면 틀린 결론에 간다:

1. **예약 등록** — 없으면 세션 밖에서 아무것도 돌지 않는다
2. **실제 응답** — 서버가 127.0.0.1:7345 에 답하는가, 트레이 뮤텍스가 잡혀 있는가
3. **기록 신선도** — `--check` (fail-closed, 낡으면 exit 1)
4. **콘솔 창** — 아래 5번

## 5. 🔴 콘솔 창이 생기지 않았는지 본다

예약 작업의 `-Hidden` 은 **작업 스케줄러 목록에서 작업을 숨기는** 옵션이다.
프로세스 창과 무관하다. action 이 `node.exe` 면 `conhost.exe` 가 붙어 창이 뜬다.

```powershell
# RetrySession 프로세스가 창을 갖고 있으면 실패다
Get-CimInstance Win32_Process -Filter "Name='conhost.exe'" |
  Where-Object { $_.ParentProcessId -in (
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { $_.CommandLine -like '*RetrySession*' } |
      Select-Object -ExpandProperty ProcessId ) }
```

`conhost` 가 있어도 창이 *보이는지*는 별개다(`CREATE_NO_WINDOW` 는 콘솔을 만들되
표시하지 않는다). 확실히 보려면 보이는 창을 열거하되, **대조군을 함께 돌려**
탐지기가 거짓 음성이 아닌지 확인하라 — 처음 만든 탐지기는 일부러 띄운 콘솔도 못 잡았다.

## 6. 커밋한다

빌드 산출물(`start.exe` · `runhidden.exe`)과 `state/` 는 커밋하지 않는다.

```bash
git add -A && git status --short | grep -i exe   # 비어 있어야 정상
```

커밋 메시지에는 **무엇을 왜 고쳤는지와 실측 근거**를 적는다. 이 저장소의 이력은
다음 사람이 제약을 되돌리지 않게 막는 유일한 장치다.

## 하지 말 것 — 되돌리면 사고가 재발한다

- `heartbeat.mjs` 에 `--loop`·`setInterval` 을 넣지 마라 (9시간 중단의 원인)
- 판정을 fail-open 으로 바꾸지 마라 ("모르면 정상"은 감시가 아니다)
- 목록이 비었다고 "아무도 안 돈다"로 읽지 마라 — `ok` 를 함께 봐라 (조회 실패가 가드를 열었다)
- `tray.ps1` 에 `ShowBalloonTip` 을 되살리지 마라 (알림은 화면에서)
- 트레이 타이머에서 동기 HTTP 를 부르지 마라 (메뉴가 최대 2.7초씩 얼었다)
- UI 바인드 주소를 `0.0.0.0` 으로 바꾸지 마라 (재시작을 띄울 수 있는 화면이다)
- Origin 검사를 빼지 마라 (아무 웹페이지나 `/api/run` 을 누를 수 있었다)
- 상태 파일을 `writeFileSync` 로 직접 쓰지 마라 (찢어지면 감시가 통째로 멈춘다)
- 단일 실행 락을 걷어내지 마라 (예약의 `MultipleInstances` 는 스케줄러끼리만 막는다)
- API 키를 도입하지 마라 (VS Code 에 로그인된 계정을 쓴다)
