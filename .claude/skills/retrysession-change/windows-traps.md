# 창 함정 — 콘솔 창 · 창 세기 · 경합 (Windows)

> [`SKILL.md`](./SKILL.md) §5 에서 갈라 왔다(그 파일이 404줄이 되어 — 규칙 400).
> 여기 셋은 한 관심사다: **창은 프로세스가 아니다.** 전부 실측으로 속은 자리다.

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

## 6. 🔴 창을 셀 때는 **프로세스가 아니라 창**을 센다

Chromium 은 같은 프로필에서 브라우저 **프로세스를 재사용**한다. 그래서 상태 창이
세 개 떠 있어도 `Get-CimInstance Win32_Process` 는 계속 1~2개를 돌려준다.

실측 (2026-09-28): 상태 창 중복을 조사하면서 프로세스를 세어 "정상"이라는 **틀린 답**을
먼저 얻었다. 파일 머리에 이미 적혀 있던 함정이다. 창을 세려면 `EnumWindows` 로
우리 프로필을 쓰는 pid 들의 **보이는·제목 있는 `Chrome_WidgetWin_1`** 을 세라
(`scripts/open-app.ps1` 의 `Get-AppWindows` 가 그대로 쓸 수 있는 모양이다).

### 6-0. 🔴 세는 명령이 **자기 자신**을 세지 않게 하라 — 세 번 걸렸다

`Where-Object { $_.CommandLine -like '*tray.ps1*' }` 는 **그 문자열을 담은 자기 명령줄**에도
맞는다. 그래서 트레이가 하나인데 늘 2개로 보인다. 2026-09-28 에도 "중복 실행 금지를
어겼나" 하고 한참 파다가, 둘째 프로세스가 **매번 1초 전에 생긴 것**이라는 데서 알아챘다.

```powershell
$me = $PID
$pat = 'tray' + '.ps' + '1'     # 리터럴을 쪼개면 자기 명령줄에 안 맞는다
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like ('*' + $pat + '*') -and $_.ProcessId -ne $me }
```

트레이가 *살아 있는지*는 애초에 명령줄로 보지 말고 **뮤텍스**로 봐라 —
`[Threading.Mutex]::TryOpenExisting('Global\EasyAI-RetrySession-Tray', [ref]$m)` 가 `True` 면 떠 있다.

### 6-1. "찾고 나서 띄운다"는 경합을 막지 못한다

창·프로세스를 하나로 유지하는 코드를 고칠 때: 클릭마다 **새 프로세스**가 뜨고 그것이
판단을 시작하기까지 초 단위가 걸린다면(`Add-Type` 컴파일 등), 그 틈에 들어온 호출은
전부 "없음"을 보고 각자 만든다. 실측: 창 0개 → 동시 3회 → **창 3개.**

두 겹으로 막는다 — **두 번째가 실제 보증이다**:

1. 락. `[IO.File]::Open(path, 'OpenOrCreate', 'Write', 'None')` — `FileShare None` 이
   기제 전부다. 아무도 쥐고 있지 않을 때만 성공하므로 **주인이 죽어 남은 파일은 락이
   아니다**(낡은 락 회수 로직이 필요 없다). 사람이 누른 동작이면 **fail-open** 으로
   둬라 — 락을 못 잡아 아무 일도 없는 것이 중복보다 나쁘다.
2. 만든 **뒤에** 다시 세어 남는 것을 정리한다. 락을 빠져나간 것은 여기서 잡힌다.

## 7. 🔴 실행 파일은 `start.exe` 하나다 — 있다 ≠ 안다 · 도는 exe 는 덮어쓰지 못한다 (2026-10-02)

`runhidden.exe` 를 `start.exe --hidden` 으로 합쳤다(사용자 요청). 그때 밟을 뻔한 셋:

- **예전 빌드는 `--hidden` 을 모른다.** 그 인자를 `start.ps1` 에 넘겨 **매번 조용히** 실패한다(작업에 창이
  없다). 그래서 «있나» 가 아니라 «아나» 를 본다 — C# 문자열 상수는 이진 안에 **UTF-16LE** 로 들어 있다
  (`scripts/launcher-lib.ps1` 의 `Get-HiddenLauncher` · `lib/ready.mjs` 의 `launcherKnowsHidden`). 실측: 예전
  8KB 빌드는 «모름», 새 9.5KB 빌드는 «앎». 🔴 실행해 보지 마라 — 예전 빌드에 `--hidden` 을 주면 창이 뜬다.
- **도는 exe 는 지우거나 덮어쓸 수 없지만 이름은 바꿀 수 있다.** 이제 상태 화면·트레이 작업이 `start.exe` 를
  감싼 채 오래 산다. 빌드가 그것을 끄면 자식은 살고 작업은 «멈춤» 이 된다(두 출처가 다른 말). 그래서
  `build-exe.ps1` 은 `start.exe.old-<시각>` 으로 **비켜 두고** 새로 만든다(실측: 작업 둘 다 계속 Running).
- `CREATE_NO_WINDOW` 자식에도 `conhost.exe` 는 붙는다 — 창이 **보이는지**는 §5 대로 대조군과 함께 센다
  (실측: 대조군 콘솔은 창 2개로 잡혔고, RetrySession 프로세스의 보이는 창은 0개).

## 8. 🔴 «완전 종료» 는 `scripts/stop-all.ps1` 하나다 (2026-10-02)

`stop.bat` · 트레이 `종료` · 창의 `종료` · `start.ps1 -Stop` · `-Uninstall` 이 모두 이것을 부른다.

- 프로세스만 끄면 멈춘 게 아니다 — 5분 감시가 새로 띄우고 로그온 때 화면·트레이가 돌아온다. 예약을
  **꺼 둔다**(지우면 `-WithResume` 같은 선택이 사라진다). `start.bat` 이 다시 켠다.
- 고를 때 «명령줄에 RetrySession 이 들어 있다» 를 쓰지 마라 — 이 폴더를 연 VS Code·`claude.exe --add-dir`
  이 걸린다. **이 폴더의** 실행기 · 정해진 스크립트를 도는 node/powershell · 우리 브라우저 프로필 · 포트 주인 ·
  재시작 회차의 자손(그것이 띄운 claude)만이다.
- 자기를 띄운 쪽(서버·트레이)은 **마지막에** 끈다. 출력을 중계하는 조상 실행기(`start.exe -Stop`)는 끄지 않는다
  — 끊으면 이 스크립트의 출력 통로가 끊긴다. `Stop-ScheduledTask` 에 기대지 않는다(그 작업의 나무에 이 스크립트가 있을 수 있다).
- `Get-ScheduledTask` 한 번이 **1.5초**다(실측). 이름마다 묻고 확인할 때 또 물었더니 종료가 16~18초 걸렸다 —
  와일드카드로 한 번 묻고 조상은 프로세스 목록 한 장으로 걸어 **6.8초**가 됐다.
- 서버가 부를 때는 **답을 먼저** 보내고 `start.exe --hidden` 으로 띄운다(`lib/shutdown.mjs`). 🔴 node 의
  `detached: true` 로 띄운 PowerShell 5.1 은 **한 줄도 돌지 않는다**(DETACHED_PROCESS = 콘솔 없음 — 대조 실험
  0/2). 화면은 «종료함» 이라 했고 시험도 통과했는데 아무것도 꺼지지 않았다 — 실제 브라우저로 눌러 보고서야
  알았다. 끈 뒤 화면은 폴링을 멈추고 «종료함» 을 말한다 — 없는 서버를 «읽기 실패» 로 외치면 늑대 외치기다.
