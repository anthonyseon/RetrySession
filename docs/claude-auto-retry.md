# claude-auto-retry 분석 — RetrySession 이 가져올 것과 버릴 것

대상: <https://github.com/cheapestinference/claude-auto-retry> (master, 마지막 푸시 2026-08-26,
★380, MIT). 이 문서는 **RetrySession 을 고치는 사람**을 위한 것이다.

읽은 것: README · `src/patterns.js` · `src/monitor.js` · `src/time-parser.js` · `src/events.js` ·
`src/config.js` · `src/reconcile.js`. 정규식과 상수는 여기 옮겨 적은 것을 믿지 말고
**가져오기 전에 원본을 다시 확인하라** — 이 문서는 요약이고, 저쪽은 계속 바뀐다.

---

## 0. 한 문장 요약

저쪽은 **사람이 보고 있는 tmux 창의 글자를 긁어** 제한·과부하를 알아채고 키를 밀어 넣는다.
우리는 **세션 밖에서 JSONL 트랜스크립트와 CLI 를 읽고** 헤드리스로 `--resume` 을 띄운다.
방향이 반대라 코드는 거의 못 가져온다. 그런데 **저쪽이 세어 둔 실패 종류**는 그대로 쓸 수 있고,
그중 하나는 우리가 **지금 당장 다치고 있는 자리**다.

| | claude-auto-retry | RetrySession |
|---|---|---|
| 감시 대상 | tmux pane 의 렌더된 글자 | `~/.claude/projects/**.jsonl` · `claude agents --json` |
| 개입 방법 | pane 에 키 입력 주입 | `claude --resume <id> -p` 헤드리스 |
| 사람이 쓰는 중이면 | **그때만** 동작 (foreground 확인) | **그때는** 안 한다 (`sessionRunning` fail-closed) |
| 기동 | 셸 래퍼 + 상주 감시 프로세스 | OS 작업 스케줄러 (감시 5분 · 재개 15분) |
| 플랫폼 | Linux/macOS (Windows 는 WSL2) | Windows 네이티브 |
| 오탐 방어 | 정규식 16종 + 툴출력 마스킹 + 장식 걸러내기 | `model === '<synthetic>'` **구조적 판별** |

---

## 1. 🔴 지금 당장 고쳐야 할 것 — API 과부하가 우리 차단기를 태운다

**저쪽이 하는 일.** 사용량 제한과 API 과부하를 **다른 경로**로 다룬다. 과부하는
`API Error: 429|500|502|503|504|529` 와 `Server is temporarily limiting requests` 로 알아채고,
지수 백오프 `30 → 60 → 120 → 240 → 300 → 300`초(각 ±15% 지터)로 물러선다.
누적 대기 상한(`maxTotalWaitMinutes`, 기본 120분)을 넘으면 **한 번만 크게 말하고 포기**한다.
Claude Code 자체 재시도가 끝난 **터미널 에러**일 때만 움직인다 — 지나가는 오류에는 손대지 않는다.

**우리 현재.** `src/resume.mjs` 는 결과를 넷으로만 가른다:

```js
const limitBlocked = didFail && !r.timedOut && isLimitFailure(`${p.summary} ${r.stderr}`)
const result = r.timedOut ? 'timeout' : !didFail ? 'ok' : limitBlocked ? '제한' : 'fail'
```

`isLimitFailure()` 는 `/limit/i` 와 `/(usage|rate|quota|reset|weekly|session limit)/i` 를 본다.
**529 도 503 도 여기 안 걸린다.** 그래서 `fail` 이 되고, `fail` 은 `failStreak` 를 올리고,
`failStreakMax: 3` 에서 **회로가 차단된다.** 그다음은 사람이 `--rearm` 을 해줄 때까지 재개가 멎는다.

**왜 이게 심각한가.** 이 저장소는 이미 같은 사고를 한 번 겪고 문서로 못 박았다 —
`guard.mjs` 의 "**제한이 차단기를 태운다.** 기다리면 될 일이 고장으로 기록되고, 제한이 풀린 뒤에도
사람이 `--rearm` 을 해줄 때까지 재개가 멎는다." 제한에는 관문을 두 겹(판정 앞 `limitState`,
판정 뒤 `isLimitFailure`) 세워 막아 놓고 **과부하는 한 겹도 안 세웠다.** 같은 사고의 다른 얼굴이다.
Anthropic 쪽이 30분 흔들리면 우리 차단기가 내려간다.

**제안.**

1. `isTransientFailure(label)` 을 `guard.mjs` 에 추가한다 — `isLimitFailure` 바로 옆이 맞다.
   저쪽 패턴을 그대로 쓰되 **우리 입력에 맞춰** 확인하라: 우리가 보는 것은 pane 글자가 아니라
   `claude -p --output-format json` 의 `result`/`stderr` 다. 실제 529 응답이 그 자리에 어떤
   문자열로 오는지 **실측한 뒤에** 패턴을 고정할 것 (근거 없는 정규식은 이 저장소의 규칙 위반).
2. `result` 에 `'overload'` 를 더하고, `recordRun()` 이 `'제한'` 과 똑같이 **failStreak 에 세지
   않게** 한다. 이미 그 자리가 있으므로 분기 하나다.
3. **백오프는 만들지 마라.** OS 트리거가 15분마다 오는 것이 이미 백오프다. 우리에게 필요한 것은
   지수 증가가 아니라 **누적 상한**인데, 그것도 `maxPerDay: 12` 가 하고 있다.
4. 다만 `'overload'` 로 끝난 회차도 **로그와 화면에는 남겨야 한다.** 조용히 넘기면 "왜 안 돌지"가
   또 안 보인다. 상세의 재시작 로그에 `overload` 로 찍고, 같은 날 3회를 넘으면 경보(warning).

시험은 "모를 때"를 함께 쓴다: 빈 문자열 · 제한과 과부하가 같이 적힌 문자열 · 타임아웃과의 구별.

---

## 2. 잠들어 잘린 응답을 재개 지점으로 인정한다

**저쪽이 하는 일.** `"Your computer went to sleep mid-response. The response above may be
incomplete."` 와 연결 끊김 변형을 감지해 **딱 한 번** 이어가기를 보낸다(`streamInterrupted`,
`maxRetries: 2`, `retryDelaySeconds: 5`).

**우리 현재.** PC 절전은 이 도구가 **예방**에 가장 공들인 자리다 — `src/pc.mjs`,
설정 모달, `pcVerdict`, powercfg 백업·검증까지. 그런데 **이미 잠들어 잘린 세션**은
재개 지점으로 안 쳐준다. `verdict()` 가 인정하는 재개 지점은 셋뿐이다:

```
추적기의 doing/todo · 재개지시(resumePrompt) · stoppedByLimit(제한으로 잘린 자리)
```

`stoppedBySleep` 은 없다. 절전으로 잘린 세션은 추적기도 재개지시도 없으면
"추적기도 재개지시도 없다"로 **영원히 거절된다.** 막으려던 사고가 실제로 났을 때
정작 복구를 안 하는 셈이다.

**제안.** `sessions.mjs` 의 `isLimitNotice()` 옆에 `isInterruptedNotice()` 를 둔다.
자리가 이미 정확히 거기다 — 마지막 assistant 엔트리를 보는 그 분기:

```js
if (isLimitNotice(m)) { acc.stoppedByLimit = true; … }
else { acc.stoppedByLimit = false }
```

여기에 `stoppedBySleep` 을 나란히 두고, `verdict()` 의 재개 지점 셋을 넷으로 늘린다.
지시문은 `buildPrompt()` 에서 "잘린 자리부터 이어라"로 갈라 준다(제한 케이스가 이미 그렇게 한다).

🔴 **주의**: 절전으로 잘린 것은 **1회만** 이어간다. 무한히 이어가면 잘린 원인이 절전이 아닐 때
같은 자리를 계속 때린다. 저쪽이 `maxRetries: 2` 로 묶어 둔 이유가 그것이다.

---

## 3. 제한 **임박** 예고를 경보로 올린다

**저쪽이 하는 일.** `Approaching your 5-hour usage limit — Claude will wrap up the current step.`
를 감지해 마무리를 한 번 재촉한다(`nearLimitWrapUp`).

**우리 현재.** 제한은 **걸린 뒤에만** 안다 — `quota.exists` 는 트랜스크립트에 남은
`quotaLimits` 이고, 그건 이미 맞은 뒤의 기록이다. 트레이의 `limited` 도 사후다.

**왜 가져올 만한가.** 감시 장치의 값어치는 **먼저 말해 주는 것**이다. "곧 제한"은
사람이 실제로 할 수 있는 일이 있는 신호다 — 지금 커밋하거나, 긴 작업을 미루거나.
우리는 재촉(키 주입)은 안 하지만 **알려 줄 수는 있다.**

**제안.** `alerts.mjs` 에 `제한임박`(warning) 한 종류. 판정은 `isLimitNotice` 와 같은 방식으로
마지막 엔트리를 보되, `<synthetic>` 여부와 문구를 **실측으로** 확인한 뒤 고정할 것.
경보는 이미 화면·트레이·`alerts.log` 로 한 곳에서 흐르므로 붙일 자리만 있으면 된다.

---

## 4. 락 신원에 **프로세스 시작 시각**을 함께 적는다 (작은 변경, 확실한 이득)

**저쪽이 하는 일.** 락 파일에 `pid` 만 적지 않고 **시작 토큰**을 함께 적는다
(Linux `/proc/<pid>/stat`, 그 밖 `ps -o lstart=`). PID 재사용을 견디기 위해서다.
낡은 락을 깰 때는 **breaker 락**으로 직렬화해 "둘이 동시에 깨고 둘 다 잡는" 부류를 막고,
지우기 직전에 **아직도 낡았는지 다시 확인**한다.

**우리 현재.** `src/lib/single.mjs` 의 `grab()` 이 적는 것은

```js
{ name, pid: process.pid, at: localStamp(), atEpoch: Date.now(), argv: … }
```

`atEpoch` 는 **락을 잡은 시각**이지 프로세스 시작 시각이 아니다. `lockState()` 가 pid 생존만
보므로, 60분 stale 창 안에 그 PID 가 **다른 프로그램에 재사용되면** "이미 돌고 있다"로 오판한다.
방향은 안전하지만(fail-closed) 결과는 **감시가 조용히 멈추는 것**이다 — 이 도구가 막으려는 바로 그것.

**제안.** 락에 프로세스 시작 시각을 함께 적고 대조한다. Windows 에서는
`Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` 의 `CreationDate` 로 얻는다.
**단, 락을 잡는 길에 PowerShell 을 띄우면 안 된다** — `taskState()` 가 7초를 먹은 그 사고와
같은 부류가 된다. 자기 자신의 시작 시각은 `Date.now() - process.uptime()*1000` 으로 공짜로 알 수 있고,
**남의** 시작 시각은 우리가 이미 5분마다 모으는 `claudeProcesses()`/`runningSessions()` 의
`startedAtEpoch` 를 재활용할 수 있는지 먼저 보라.

breaker 락까지는 필요 없다 — 우리는 `wx` 로 원자적 생성을 이미 쓰고 있고, 회수 뒤 재시도를
한 번만 하고 양보한다(`'낡은 락을 회수하는 사이에 다른 프로세스가 잡았다'`).

---

## 5. 커버리지 자가 치유(reconcile) — **감시만** 따라 할 만하다

**저쪽이 하는 일.** `reconcile` 이 살아 있는 claude pane 중 **감시가 안 붙은 것**을 찾아
감시를 붙인다. systemd/launchd 타이머로 5분마다 돌려, 감시자가 죽어도 한 주기 안에 복구된다.
커버리지 키는 **PID 가 아니라 pane** — "멈춘 claude 도 감시자는 살아 있다"는 이유다.
`--dry-run` 은 **읽기만 하므로 락도 안 잡는다.**

**우리 현재.** 감시자 복구는 OS 예약이 이미 한다(작업이 죽어도 다음 트리거에 다시 뜬다).
빠진 것은 **등록되지 않은 채 돌고 있는 세션**이다 — 지금 12개 중 8개가 그렇다.
화면은 "세션 행에 짝지어지지 않은 claude 프로세스"로 **보여주기만** 한다.

**제안.** `autoWatch` 옵션(기본 꺼짐)을 두어, 등록된 저장소 안에서 도는 **새 세션에 감시만**
자동으로 켠다. 감시는 기록만 하므로 무해하다.
🔴 **재시작은 절대 자동으로 켜지 마라.** 돈을 쓰고 파일을 고치는 스위치는 사람이 켠다.
저쪽이 자동으로 붙이는 것도 "감시"이지 "실행"이 아니다.

`--dry-run` 이 락을 안 잡는 것은 우리도 점검해 볼 값어치가 있다 — 지금 `--dry-run` 이
락을 잡는다면, 사람이 판정을 미리 보는 동안 예약 회차가 밀린다.

---

## 6. Claude Code 훅(StopFailure) — 구조를 바꾸는 선택지

**저쪽이 하는 일.** 화면 긁기 말고 **Claude Code 자체 훅**으로 실패를 받는다.
훅이 `~/.claude-auto-retry/events/{socketKey}_{paneKey}.json` 에 마커를 원자적으로(임시파일→rename)
쓰고, 감시자가 읽어 소비한다. 마커에는 `pane · error · session_id · ts` 가 들어가고,
`maxAgeMs` 를 넘긴 마커는 **버린다**(pane id 재사용으로 옛 실패가 되살아나는 것을 막는다).
재시도 대상은 `overloaded` 와 `server_error` **둘뿐** — `rate_limit` 은 시간 단위 대기라
초 단위 백오프로 다룰 일이 아니라고 명시적으로 뺐다.

**우리에게 뜻하는 것.** 우리는 지금 **밖에서 폴링**만 한다(5분/15분). 훅은
**사람이 지금 쓰고 있는 세션**에서 일어난 실패를 즉시 알려 주는 유일한 통로다 —
`sessionRunning` 이 fail-closed 로 막는 그 세션에서도.

**트레이드오프(이건 설계 결정이라 사람이 정할 일이다).**

- 얻는 것: 지연 0 · 오탐 0(구조화된 이벤트) · 실행 중 세션도 도울 수 있다
- 내주는 것: 이 도구는 "**세션 밖에서**" 도는 것이 정체성이다. 훅은 사용자의 Claude 설정
  안에 우리 것을 심는다. 설치·제거·버전 호환을 우리가 책임져야 한다
- 부분 채택안: 훅은 **기록만** 하고(마커 파일) 아무것도 띄우지 않는다. 화면과 경보가 그것을
  읽어 "이 세션이 API 오류로 끝났다"를 **보여주기만** 한다. 개입은 지금처럼 예약이 판단한다.
  이러면 정체성을 지키면서 신호만 얻는다

마커 설계에서 바로 배울 것 둘: **원자적 쓰기**(우리 `writeJsonAtomic` 과 같은 이유)와
**마커 만료**(낡은 신호로 행동하지 않는다 — 우리 `heartbeatVerdict` 의 낡음 판정과 같은 정신).

---

## 7. 우리가 이미 같은 결론에 닿은 것들 (확증으로 기록)

- **`setInterval` 대신 재귀 `setTimeout`.** 저쪽 주석: "틱이 폴 주기보다 오래 걸릴 때 겹쳐 도는
  것을 막는다." 우리는 2026-09-22 에 화면에서 똑같은 자리를 밟고 `pollLoop` 로 고쳤다.
- **연속 실패 후에는 조용히 버틴다.** 저쪽은 포기 로그를 **한 번만** 찍고 멈춘다. 우리 재시작
  로그는 15분마다 같은 SKIP 을 계속 쌓는다(실측: 21회차 전부 `SKIP · 세션이 실행 중이다`).
  **같은 이유의 SKIP 이 이어지면 접어서 한 줄로** 기록하는 편이 읽힌다. 다만 **줄이지 말고 접어라** —
  "아무 기록이 없다"와 "같은 이유로 건너뛰는 중"은 달라야 한다.
- **설정이 깨져도 뜬다.** 저쪽은 잘못된 값을 기본값으로 대체하고, 컴파일 안 되는 정규식을 걸러낸다.
  감시 장치가 설정 하나 때문에 안 뜨면 아무것도 못 지킨다는 판단인데, **옳다.**
  단 저쪽은 **경고를 안 낸다** — 그건 가져오면 안 된다(아래 8번).

---

## 8. 가져오면 안 되는 것

1. **화면 긁기 전체(tmux capture-pane + 정규식 16종).**
   저쪽 `patterns.js` 의 대부분은 **터미널이라서 생긴 문제**를 푼다 — ANSI 이스케이프 4종 제거,
   입력 상자·푸터·스피너 같은 장식 걸러내기, 툴 출력에 **인용된** 에러를 실제 에러로 오해하지
   않기(tool-echo 마스킹), 산문과 렌더 구분.
   우리는 JSONL 을 읽고 `isLimitNotice()` 가 `normalizeModel(message.model) === '<synthetic>'`
   로 **먼저 가른다.** 사람이 쓴 글이나 툴 출력은 `<synthetic>` 이 아니므로 **애초에 후보가 아니다.**
   저쪽 규칙을 흉내 내면 없던 오탐 경로를 새로 만드는 셈이다.
2. **키 입력 주입.** 우리 안전장치의 핵심은 "사람이 쓰는 대화에 끼어들지 않는다"이고,
   `sessionRunning` 은 `--force` 로도 안 뚫린다. 저쪽은 정반대로 **사람의 창에 키를 밀어 넣는다**
   (그래서 foreground 확인이 필요하다). 방향이 반대라 안전장치도 반대다.
3. **조용한 기본값 대체.** 저쪽 `config.js` 는 잘못된 설정을 **경고 없이** 기본값으로 바꾼다.
   우리는 방금(2026-09-22) 정확히 반대 방향으로 고쳤다 — "고쳐도 아무 일 없는 설정은 거짓말"이라
   읽지 않는 키를 없애고 `test/config.test.mjs` 로 막았다.
   가져올 것은 "**떠야 한다**"이고 버릴 것은 "**조용히**"다. 기본값으로 물러서되 **경보를 남긴다.**
4. **tmux 의존.** 우리는 Windows 네이티브이고, `cmd.exe` 도 배제한 저장소다.
5. **저쪽의 시각 파싱(`time-parser.js`).** DST 를 3회 수렴으로 푸는 것은 훌륭하지만,
   그건 **화면에 찍힌 `resets 3pm (UTC)` 를 읽어야 해서** 필요한 것이다. 우리는
   `quotaLimits.resetsAt` 을 **epoch 초**로 받는다 — 이미 모호함이 없다.
   사람이 읽는 문자열을 다시 파싱하는 쪽으로 물러서지 마라.

---

## 9. 우선순위와 **반영 결과** (2026-09-22 적용 완료)

| 순위 | 항목 | 상태 | 어디에 |
|---|---|---|---|
| 1 | API 과부하를 `fail` 로 세지 않기 (§1) | ✅ 반영 | `guard.isTransientFailure` · `result: 'overload'` · `overloadByDay` · 경보 `과부하잦음` |
| 2 | 끊긴 응답을 재개 지점으로 (§2) | ✅ 반영 | `sessions.isInterruptedNotice` · `stoppedByInterrupt` · 재개 지점 넷째 |
| 3 | 락 신원에 시작 시각 (§4) | ✅ 반영 | `single.procStartEpoch` — **거절하는 길에서만** 확인한다 |
| 4 | 제한 임박 경보 (§3) | ❌ **안 함** | 아래 참조 |
| 5 | 같은 이유 SKIP 접기 (§7) | ✅ 반영 | `io.appendOrFold` · `resume.logSkip` |
| 6 | `autoWatch` — 감시만 자동 (§5) | ✅ 반영 | `lib/autowatch.mjs` · 기본 꺼짐 · **재시작은 제외** |
| 7 | 훅으로 신호만 받기 (§6) | ⏸ 보류 | 정체성과 맞바꾼다 — 사람이 정할 일 |

### 🔴 4번을 하지 않은 이유 — **신호가 없다**

문구를 지어내지 않고 먼저 찾아봤다. 트랜스크립트 **800파일·106,329줄**을 훑은 결과:

| 찾은 것 | 건수 | 모델 |
|---|---|---|
| `You've hit your ... limit · resets ...` | 171 (고유 9) | `<synthetic>` |
| `API Error: The response stopped arriving. …` | 3 | `<synthetic>` |
| `API Error: 529 Overloaded. …server-side issue, usually temporary…` | 1 | `<synthetic>` |
| `API Error: 400 tools.11.custom.input_schema…` | 10 | `<synthetic>` |
| **`Approaching your … limit`** | **0** | — |

저쪽이 잡는 "한계 임박" 예고는 **이 PC 의 기록에 한 번도 나타나지 않았다.** 터미널에만
잠깐 뜨고 트랜스크립트에는 남지 않는 것으로 보인다. 근거 없는 정규식을 넣으면
영원히 안 걸리는 죽은 코드가 되고, 다음 사람은 그것이 동작한다고 믿는다.
**신호를 확인하면 그때 넣는다.**

이 표에서 또 배운 것: `API Error: 400` 이 10회로 가장 잦다. 이것을 "지나가는 실패"로
읽었다면 고칠 때까지 하루 상한 12회를 계속 태웠을 것이다 — `isTransientFailure` 가
영구 오류를 **먼저 배제**하는 이유다.

### 반영하면서 드러난 것 둘

- **`--rearm --session <없는id>` 가 전부를 풀고 있었다.** 고른 것이 0개면 "전부"로
  물러서는 코드였다. 오타 하나로 다른 세션의 회로 차단까지 지워진다 — HTTP 쪽에서
  이미 고친 것과 같은 부류(없는 sessionId → 400)라 여기서도 거절로 바꿨다.
- **`toISOString().slice(0,10)` 은 쓰면 안 된다.** 기록은 `dayKey()`(로컬)로 쓰는데
  읽기를 UTC 로 하면 Asia/Seoul 에서 하루 9시간 동안 없는 날짜를 찾는다 —
  세어 놓고도 늘 0 으로 보인다. 쓰기와 읽기는 같은 함수를 쓴다.

무엇을 하든 이 저장소의 절차는 그대로다:
고친다 → `.\start.ps1 -Restart` 로 **반영**한다 → `npm test` → `start.exe -Status` 로 **실측** →
콘솔 창 0개 확인 → 근거를 커밋 메시지에 남긴다. 새 판정을 넣었으면 **"모를 때"의 시험을 함께** 쓴다.
