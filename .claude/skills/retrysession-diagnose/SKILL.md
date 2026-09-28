---
name: retrysession-diagnose
description: RetrySession 이 예상대로 동작하지 않을 때의 진단 절차. 감시 기록이 안 남거나, 재시작이 안 돌거나, 화면·트레이가 안 뜨거나, 세션이 목록에 안 보이거나, 콘솔 창이 뜨거나, 예약 작업이 실패로 남을 때 사용한다. 증상마다 원인이 갈리는 지점과 그것을 가르는 명령을 담았다.
---

# RetrySession 이 안 돌 때

**증상 하나에 원인이 여럿이고, 대처가 서로 다르다.** 먼저 가르고 나서 고쳐라.
추측으로 재등록하거나 재시작하면 멀쩡한 것을 부수고 진짜 원인을 덮는다.

## 먼저 — 한 번에 전부 본다

```powershell
.\start.exe -Status
```

여기서 네 가지가 각각 나온다. **하나만 보고 판단하지 마라.**

| 나오는 것 | 뜻 |
|---|---|
| scheduled tasks | 예약이 **등록**돼 있나 · 마지막 결과 |
| actually running | 서버가 **응답**하나 · 트레이가 살아 있나 |
| record freshness | **기록**이 신선한가 (fail-closed) |
| resume budget | 재시작 예산·차단 상태 |

## 증상 1 — 감시 기록이 안 남는다

원인이 둘이고 대처가 반대다. **이 구별이 이 프로젝트의 핵심 교훈이다.**

| 예약 등록 | 기록 | 원인 | 대처 |
|---|---|---|---|
| 있음 | 낡음 | 작업은 도는데 **실패**하고 있다 | 로그·결과 코드를 읽는다 |
| 없음 | 낡음 | 작업 자체가 **사라졌다** | 재등록한다 |

```powershell
# 결과 코드를 뜻으로 읽는다 (267009=실행 중, 267011=아직 실행 안 됨, 0xC000013A=중지됨)
.\start.exe -Status
```

```bash
# 실패하고 있다면 여기에 이유가 있다
cat state/sessions/<sessionId>/heartbeat.log | tail -20
```

감시 대상이 **하나도 없으면** 기록이 없는 게 정상이다:

```bash
npm run list        # 대상 목록. 비어 있으면 화면에서 세션을 골라 켜라
```

## 증상 2 — 재시작이 돌지 않는다

**대부분 정상이다.** 가드에 막힌 것은 실패가 아니다.

🔴 **먼저 화면을 봐라.** 세션 줄의 배지가 `재시작 켬 · 대기 (실행중)` 처럼 **무엇이
막는지 한 단어**로 말한다(배지에 마우스를 올리면 자세한 이유, 상세의 **재시작 로그**
탭 맨 위에는 판정 패널과 고치는 단추). 화면과 재개는 **같은 판정**
(`lib/resume-gate.mjs`)을 쓰므로 둘이 다를 수 없다 — 다르면 그게 결함이다.

`재시작 꺼짐` 이면 스위치가 안 켜진 것이고, `재시작 켬 · …` 이면 켜진 것이다.
누른 결과는 동작줄 오른쪽에 적힌다(`✖` 로 시작하면 적용되지 **않았다**).

명령으로 보려면:

```bash
npm run resume:dry      # 가드 판정 + 넘길 지시문까지 보여준다
npm run resume:status   # 예산·연속실패·차단·과부하 횟수
```

흔한 이유와 뜻 (괄호는 배지의 단어):

- `세션이 실행 중이다 (pid ...)` (실행중) — 사람이 쓰는 세션은 건드리지 않는다. `--force` 로도 안 뚫린다.
- `방금까지 활동이 있었다` (활동중) — 아직 사람이 붙어 있을 수 있다
- `할 일이 없다 (n/n 전부 done)` (할일없음) — 추적기가 끝났다
- `추적기도 재개지시도 없다` (지시없음) — 무엇을 이어서 할지 정해지지 않았다. 상세 → 설정 탭에서 재개지시를 넣어라.
- `이 저장소는 자율 재개가 꺼져 있다` (저장소잠금) — `config/projects.json` 의 `resume.enabled`. `--force` 로도 안 뚫린다.
- `회로 차단됨` (연속실패) — 원인을 고친 뒤 `npm run resume:rearm` 또는 판정 패널의 [차단 해제]
- `끊긴 응답을 이미 한 번 이어 봤는데 또 끊겼다` (반복끊김) — 원인이 절전이 아니다. 재개지시로 방향을 바꿔라.

로그에 같은 이유가 이어지면 `SKIP ×4 (처음 …)` 로 **접혀서** 쌓인다 — 줄이 안 늘어난다고
안 도는 것이 아니다.

**`limited`·`overload` 로 끝난 회차는 실패가 아니다.** 사용량 제한과 API 과부하(529·5xx)는
연속실패로 세지 않는다 — 기다리면 풀린다. 과부하가 하루 3회를 넘으면 경보로 올라온다.

## 증상 3 — 화면이 안 열린다 / 트레이가 없다

```powershell
.\start.exe                 # 서버·트레이를 확인하고 창을 연다
```

그래도 안 되면 순서대로:

```powershell
# 1) 서버가 응답하나
curl http://127.0.0.1:7345/api/tray

# 2) 포트를 누가 잡고 있나 (낡은 프로세스가 잡고 있으면 새 서버가 EADDRINUSE 로 죽는다)
Get-NetTCPConnection -LocalPort 7345 -State Listen | Select OwningProcess

# 3) 재등록 — 포트를 먼저 비우고 응답까지 확인한다
.\scripts\register-ui.ps1
```

**트레이 아이콘이 안 보이면** 숨겨진 것일 수 있다(Windows 11 기본).
설정 > 개인 설정 > 작업 표시줄 > 기타 시스템 트레이 아이콘. `register-tray.ps1` 이
고정을 시도하지만 실패할 수 있다.

트레이가 *실행 중인지*는 뮤텍스로 판정한다. 명령행 매칭은 거짓 양성이 난다
(진단 명령 자신이 `tray.ps1` 문자열을 포함해 걸린다).

### 증상 3-1 — 상태 창이 **여러 개** 열린다

```powershell
.\scripts\open-app.ps1 -NoWait   # "already open - brought it to the front." 라고 해야 정상
```

🔴 **프로세스를 세지 마라.** Chromium 은 같은 프로필에서 브라우저 프로세스를
재사용하므로 창이 셋이어도 pid 는 1~2개다 — 실측으로 이 함정에 두 번 빠졌다.
창을 세려면 `open-app.ps1` 의 `Get-AppWindows` 와 같은 방식(`EnumWindows` +
보이는·제목 있는 `Chrome_WidgetWin_1`)을 써야 한다.

중복이 생겼다면 보통 **경합**이다: 클릭마다 새 powershell 이 뜨고 그것이 `Add-Type`
컴파일을 끝내기까지 초 단위가 걸려, 그 틈의 클릭들이 모두 "창 없음"을 본다.
지금은 두 겹으로 막혀 있다 — `state/locks/open-app.lock`(배타 열기) 과
**띄운 뒤 남는 창 정리**. 둘 중 뒤쪽이 실제 보증이므로, 중복이 다시 보이면
사후 정리가 도는지부터 확인하라(`-KeepExtra` 로 끄고 들여다볼 수 있다).

## 증상 4 — 세션이 목록에 없다

**열린 폴더와 세션은 다른 것이다.** 순서대로 가려라:

1. **화면의 "열린 폴더" 줄** — `여기서 시작한 세션 없음` 이면 그 폴더에서 Claude Code 를
   시작한 적이 없다는 뜻이다. 빠뜨린 게 아니다.
2. **목록 끝의 "짝지어지지 않은 claude 프로세스"** — CLI 가 모르는 프로세스도 여기 나온다.
3. 그래도 없으면 프로세스를 직접 본다:

```powershell
Get-CimInstance Win32_Process -Filter "Name='claude.exe'" |
  Select-Object ProcessId, CommandLine | Format-List
```

명령행에서 갈린다:
- `--claude-in-chrome-mcp` → **보조 프로세스**, 세션이 아니다
- `--add-dir <폴더>` → 그 폴더는 **덧붙인 폴더**이지 세션의 시작 위치가 아니다
- `--resume=<id>` → 이어받은 세션 id

실측 사례: `claude agents --json` 이 세션 2개를 보고할 때 실제 `claude.exe` 는 4개였다.

## 증상 5 — 콘솔 창이 뜬다

예약 작업의 action 이 `node.exe` 를 직접 부르고 있다. `-Hidden` 설정은 소용없다
(그건 작업 스케줄러 목록에서 작업을 숨기는 옵션이다).

```powershell
# action 확인 — runhidden.exe 를 거쳐야 한다
(Get-ScheduledTask -TaskName 'EasyAI-RetrySession-UI').Actions[0].Execute

# 고치기
.\scripts\build-exe.ps1      # runhidden.exe 가 없으면 만든다
.\scripts\register-ui.ps1    # 감시·재시작도 같은 방식으로 재등록
```

## 증상 6 — 예약 작업이 실패로 남는다

결과 코드를 먼저 뜻으로 읽어라. **실패가 아닌 것들이 있다:**

| 코드 | 뜻 |
|---|---|
| `0` | 성공 |
| `267009` | 실행 중 (서버·트레이는 이게 정상이다) |
| `267011` | 아직 실행되지 않음 |
| `0xC000013A` | 중지 신호로 종료 (`Stop-ScheduledTask` 등) |
| `2` | 우리 쪽에서는 보통 **포트 충돌** |

낡은 결과가 남아 경보로 보일 수 있다. 한 번 돌려보고 다시 확인하라:

```powershell
Start-ScheduledTask -TaskName 'EasyAI-RetrySession-Heartbeat'
Start-Sleep 12
(Get-ScheduledTaskInfo -TaskName 'EasyAI-RetrySession-Heartbeat').LastTaskResult
```

🔴 `Stop-ScheduledTask` 직후 `Start-ScheduledTask` 는 먹지 않는 경우가 있다
(상태가 Ready 로 남고 `0xC000013A` 로 끝난다). **재등록이 확실한 복구 경로다.**

## 증상 7 — 고쳤는데 반영이 안 된다

살아 있는 node 프로세스는 기동 시점의 모듈을 들고 있다.

```powershell
.\start.exe -Restart
```

## 증상 8 — "이미 돌고 있다" 며 건너뛴다

정상이다. 중복 실행은 막혀 있고, 그래서 `exit 0` 이다.

진짜로 아무것도 안 도는데 이 메시지가 나오면 **유령 락**이다.
락은 pid 생존과 시간 한계를 둘 다 보므로 보통 스스로 회수하지만, 확인하려면:

```bash
ls state/locks/ && cat state/locks/*.lock
```

`pid` 가 죽어 있으면 다음 실행이 회수한다. 급하면 해당 `.lock` 을 지워도 된다 —
다만 **정말로 안 돌고 있는지 먼저 확인**하라. 도는 것을 지우면 중복이 생긴다.

## 마지막 수단 — 전부 다시 세운다

```powershell
.\start.exe -Uninstall      # 예약 전부 해제 (state\ 는 남는다)
.\scripts\build-exe.ps1
.\start.exe -Install        # 다시 등록 (재시작까지 원하면 -WithResume)
```

`state/` 는 지워지지 않으므로 감시 대상·이력·예산이 그대로 돌아온다.
