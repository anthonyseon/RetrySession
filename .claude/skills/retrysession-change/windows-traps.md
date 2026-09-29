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
