# 보이는 숫자가 의심스러울 때 — 사용량 · 추적기 · CLI 버전

> [`SKILL.md`](./SKILL.md) 의 증상 9·10·11 이다(그 파일이 406줄 — 규칙 400).
> 셋을 한 파일에 둔 이유: 전부 **«그 값이 어디서 왔나»** 하나로 갈린다.
> 숫자가 이상할 때 고칠 것은 대개 계산이 아니라 **출처**다.

## 증상 9 — 사용량 패널의 숫자가 이상하다

**먼저 어느 숫자인지 가려라. 패널의 네 묶음은 출처가 다르고, 섞으면 진단이 엉킨다**
(전체 설명은 [`docs/usage-panel.md`](../../../docs/usage-panel.md)):

| 보이는 것 | 출처 | 이상할 때 |
|---|---|---|
| `Session (5hr) N%` · `Weekly (7 day) N%` | **Claude 계정의 공식 값** (`/api/oauth/usage`) | 아래 표를 본다 |
| `최근 24시간 요청 N` | `claude -p /usage` (근사값) | 그쪽 본문 그대로다 — 우리가 만든 값이 아니다 |
| `사용량 제한` 묶음 | 트랜스크립트의 제한 알림 | **관측 시점**의 기록이다. 지금 상태가 아닐 수 있다 |
| 토큰·정가 (오늘/누적/모델별) | 우리 실측 | 자정 경계·모델 단가를 본다 |

```bash
curl -s -H "Origin: http://127.0.0.1:7345" "http://127.0.0.1:7345/api/usage?fresh=1"
```

응답의 `officialOk`·`officialError` 가 답을 가른다:

| 화면·응답 | 뜻 | 대처 |
|---|---|---|
| `받지 못함` + `401` | 계정 토큰이 거부됐다 | Claude Code 를 한 번 열면 갱신된다(우리는 갱신하지 않는다) |
| `받지 못함` + `만료` | 토큰 유효기간이 지났다 | 같다. `tokenExpiresInMin` 이 음수다 |
| `받지 못함` + `해석할 수 없습니다` | 🔴 **응답 서식이 바뀌었다** | `lib/oauth-usage.mjs` 의 `parseOfficial` 을 고친다 |
| `받지 못함` + `로그인 정보를 읽을 수 없습니다` | `~/.claude/.credentials.json` 이 없다 | VS Code 에서 로그인 |
| 퍼센트는 나오는데 **토큰과 안 맞는다** | 정상이다 | 🔴 **둘은 단위가 다르다** — 나누지 마라(그렇게 추정하다 100% vs 7% 를 만들었다) |

🔴 **추정으로 되돌리지 마라.** 「실측 ÷ 기준선」 으로 퍼센트를 만들던 코드는 걷어냈다
(2026-09-29). 공식 값을 못 받으면 **숫자를 만들지 않는 것이 맞다** — 그 자리에 이유를 적고,
사람은 대화 안에서 `/usage` 로 정확한 값을 본다.

## 증상 10 — 추적기(`9/9` 같은 숫자)가 며칠째 그대로다

**화면이 낡은 것이 아니다.** 추적기는 캐시 없이 3초마다 파일을 다시 읽는다(`readTracker`).
바뀌지 않는 것은 **파일**이고, 이유는 셋 중 하나다 — 배지 툴팁이 그것을 말한다:

1. **그 장부의 일이 끝났다** — `9/9 done`. 상태의 정본이 다른 파일·문서로 옮겨간 경우가 많다.
   설정이 가리키는 곳을 바꿔라(`config/projects.json` 의 `tracker`).
2. **그 세션은 재개지시로 돈다** — 배지에 그렇게 적힌다. 🔴 재개지시 경로의 지시문에는
   **추적기 규약이 들어가지 않으므로**(`lib/prompt.mjs`) 무인 회차가 장부를 고치지 않는다.
   추적기로 돌리려면 설정 탭의 재개지시를 비운다.
3. **RetrySession 은 이 파일을 쓰지 않는다** — 읽기 전용이다. 갱신은 재개된 세션이 한다.
   회차 요약에 「추적기를 갱신하지 못했다」가 적혀 있으면 그 저장소의 규약·권한을 본다(증상 2-2).

```bash
# 파일이 실제로 언제 바뀌었나 (화면의 「N일 그대로」와 같은 값이다)
node -e "const c=require('./config/projects.json');const p=require('path'),f=require('fs');for(const x of c.projects){if(!x.tracker)continue;const q=p.join(x.repo,x.tracker);console.log(x.id,x.tracker,f.existsSync(q)?f.statSync(q).mtime.toLocaleString('ko-KR'):'없음')}"
```

## 증상 11 — 회차가 **몇 초 만에** `400 does not support this model` 로 끝난다

```text
RUN 끝 · fail · 7초 · $0 · 턴 1 · exit 1
  API Error: 400 Claude Code 2.1.246 does not support this model;
  version 2.1.280 or newer is required. Run 'claude update' …
```

🔴 **우리가 띄운 CLI 가 그 세션의 모델을 모른다.** 이 기계에는 설치본이 둘 있을 수 있고
(npm 전역 · VS Code 확장 번들) 사람의 세션은 보통 **확장 것**으로 돈다. 실측(2026-09-30):
npm 2.1.246 · 확장 2.1.283 · 그 세션 모델 `claude-opus-5-5` → 낡은 쪽이 400 으로 거부했다.
대조군으로 확인했다 — 같은 모델을 2.1.246 은 거부하고 2.1.283 은 답했다.

무엇을 띄우고 있고 그 세션은 무엇으로 돌았나:

```bash
npm run cli:which          # 설치본 목록(버전은 실행 없이 읽는다) + 고른 것
npm run resume:status      # 예산·차단·CLI낡음 횟수 (세션 줄의 `cliVer` 는 위 명령이 함께 보여준다)
```

올리는 방법 — **`claude update` 를 믿지 말고 결과를 봐라**(실측 09-30):

```bash
npm view @anthropic-ai/claude-code version   # 나와 있는 최신 (이것이 사실의 기준)
npm install -g @anthropic-ai/claude-code@latest
npm run cli:which                            # 올라갔는지 · 우리가 그것을 고르는지
```

🔴 `claude update` 가 「Unable to fetch latest version from npm registry」로 **실패했는데
`npm view` 는 2.1.285 를 답했다** — 즉 그물 문제가 아니라 그쪽 갱신 경로의 문제였다.
npm 으로 올리면 됐다. 올린 뒤 `postinstall` 경고(`allow-scripts`)가 떠도 `--version` 이
새 번호를 답하면 된 것이다. VS Code 확장은 VS Code 가 갱신한다(우리가 만지지 않는다).

그리고:

- `claudeBin()` 은 설치본 중 **가장 새것**을 고른다(09-30부터). RetrySession 은 CLI 를 **설치하지
  않는다** — PC 설치본을 부른다. 그래서 고칠 것은 «우리 것» 이 아니라 **PC 의 설치본**이다.
- 🔴 «세션마다 그 세션이 쓰던 버전으로 부르면 되지 않나» — **가능하다**(판단 09-30). 재료가 이미
  셋 다 있다(세션의 `cliVer` · `claudeInstalls()` · `runClaude` 의 exe 주입). 다만 규칙은 «같은
  버전» 이 아니라 «그 세션 버전 **이상**» 이어야 하고, 이상이 없을 때의 정책을 정해야 한다 —
  설계 판단은 `retrysession-change` 스킬의 §1-1-4 에 적어 뒀다.
- 이 실패는 `outdated` 로 갈리고 **연속실패를 올리지 않는다** — 재시도로 낫지 않기 때문이다.
  대신 «CLI낡음» 치명 경보로 올라오고, 어긋남은 튕기기 **전에** «CLI어긋남» 경고로 뜬다.
- 🔴 `RUN 끝 · fail` 인데 요약이 이 문구라면 **옛 버전이 남긴 기록**이다(그때는 fail 로 셌다).
  그 회차가 올린 연속실패는 실제 고장이 아니므로 [차단 해제] 로 풀어도 된다.
