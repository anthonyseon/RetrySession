/**
 * classify.mjs — 실행 1회가 남긴 **문구를 읽어 결과 이름을 정한다.** 순수 함수만.
 *
 * 🔴 이 파일이 정하는 것은 이름 하나지만, 그 이름이 **차단기를 태울지**를 정한다.
 *   `fail` 만 연속실패를 올린다(guard.recordRun). 제한·인증·과부하는 올리지 않는다 —
 *   기다리면 풀릴 일에 회로를 차단하면 저쪽이 멀쩡해진 뒤에도 사람이 `--rearm` 을
 *   해줄 때까지 재개가 멎는다. 같은 사고를 세 번 겪고 세 칸이 생겼다:
 *     · 제한 (2026-09-17 무렵)  · 과부하 529 (2026-09-22)  · 인증 만료 (2026-09-28)
 *
 * 🔴 차단하지 않는 것을 **조용히 넘기지도 않는다.** 세 칸 모두 하루 횟수를 세고
 *   (guard.recordRun 의 overloadByDay·authByDay) 화면과 경보가 그것을 말한다.
 *   차단하지 않기로 한 대가는 침묵이 아니라 설명이다.
 *
 * 🔴 왜 guard.mjs 에서 떼어냈나 — 400줄 규칙을 넘겼고, 자를 자리가 여기였다.
 *   guard.mjs 는 "지금 띄워도 되나"(낡음·조용한시간·예산·락)를, 이 파일은
 *   "띄운 결과가 무엇이었나"를 본다. 앞의 것은 상태를 읽고 뒤의 것은 문구를 읽는다.
 */

/**
 * 이번 실행이 **사용량 제한 때문에** 실패했는가.
 *
 * 제한 전 확인을 통과했더라도(기록이 낡았거나 방금 걸렸거나) 실제로는 막힐 수 있다.
 * 그때 이것을 실패로 세면 세 번 만에 회로가 차단된다 — 기다리면 될 일에.
 * 🔴 모르면 실패로 센다(false) — 진짜 고장을 제한으로 감추면 안 된다.
 */
export function isLimitFailure(label) {
  const s = String(label || '')
  if (!s) return false
  return /limit/i.test(s) && /(usage|rate|quota|reset|weekly|session limit)/i.test(s)
}

/**
 * 이 실패는 **저쪽이 잠깐 흔들린 것**인가 (API 과부하·서버 오류).
 *
 * 🔴 왜 필요한가 — 제한이 차단기를 태우는 것과 **같은 사고의 다른 얼굴**이다.
 *   제한은 두 겹으로 막아 뒀는데(판정 앞 guard.limitState, 판정 뒤 isLimitFailure)
 *   과부하는 한 겹도 없었다. 529 는 isLimitFailure 에 안 걸려 'fail' 이 되고,
 *   'fail' 세 번이면 회로가 차단되어 **사람이 --rearm 할 때까지 재개가 멎는다.**
 *   Anthropic 쪽이 45분 흔들리면 우리 차단기가 내려가는 셈이다. 기다리면 될 일에.
 *
 * 🔴 영구 오류를 지나가는 것으로 읽으면 반대쪽 사고가 난다 — 고장 난 채로
 *   영원히 다시 시도한다. 그래서 **아는 영구 오류를 먼저 배제**한다.
 *   실측(트랜스크립트 800파일·106,329줄, 2026-09-22): 실제로 나타난 것은
 *     · `API Error: 529 Overloaded. This is a server-side issue, usually temporary …`  ← 지나간다
 *     · `API Error: 400 tools.11.custom.input_schema.properties: …`                    ← 영구(10회)
 *   400 을 지나가는 것으로 봤다면 스키마가 틀린 채로 하루 12회를 계속 태웠을 것이다.
 */
export function isTransientFailure(label) {
  const s = String(label || '')
  if (!s) return false
  // 고칠 때까지 계속 실패할 것들 — 재시도가 답이 아니다
  if (/\bAPI Error:\s*(400|401|403|404|405|413|422)\b/i.test(s)) return false
  if (/\bAPI Error:\s*(408|425|429|5\d\d)\b/i.test(s)) return true
  return /(overloaded|service unavailable|bad gateway|gateway timeout|temporarily limiting requests|server[- ]side issue)/i.test(s)
}

/**
 * 이 실패는 **로그인이 끊긴 것**인가.
 *
 * 🔴 실측 결함 (2026-09-28). 이 저장소의 첫 실제 자율 재개가 이렇게 끝났다:
 *     `RUN 끝 · fail · 5초 · $0 · 턴 1 · exit 1`
 *     `Failed to authenticate: OAuth session expired and could not be refreshed`
 *   재 보니 isLimitFailure·isTransientFailure 둘 다 false → 'fail' → 연속실패 3회면 차단.
 *   그런데 몇 분 뒤 `claude auth status` 는 다시 정상이었다(토큰이 갱신됐다).
 *   즉 **저절로 낫는 일에 차단기를 태우고** 사람에게 `--rearm` 을 시킨다 —
 *   제한·과부하에서 이미 두 번 고친 바로 그 실패 방식이다.
 *
 * 🔴 대신 조용해서는 안 된다. 제한·과부하는 기다리면 풀리지만 이건 사람이
 *   다시 로그인해야 할 수도 있다. 그래서 차단은 하지 않고 **경보로 올린다**
 *   (alerts.mjs 의 `로그인끊김`·`인증실패`). 차단과 침묵 사이를 그렇게 가른다.
 *
 * 🔴 403 은 넣지 않는다 — 그건 권한이지 인증이 아니고, 고쳐야 낫는다.
 *   판정은 실패한 회차에만 쓰이므로(didFail) 대화 내용이 이 문구를 담을 여지는 좁다.
 */
export function isAuthFailure(label) {
  const s = String(label || '')
  if (!s) return false
  if (/failed to authenticate|authentication[_ ]error/i.test(s)) return true
  if (/(oauth|access|refresh)[- ]?(session|token)s? (has |have )?(expired|revoked)/i.test(s)) return true
  if (/(not logged in|logged out|no credentials|credentials (not found|missing)|invalid api key)/i.test(s)) return true
  if (/(run|use)\s+\/?login\b|\bclaude (auth )?login\b/i.test(s)) return true
  return /\bAPI Error:\s*401\b/i.test(s)
}

/**
 * 이 실패는 **우리가 띄운 CLI 가 낡아서** 인가.
 *
 * 🔴 실측 결함 (2026-09-30): 무인 재개가 7초에 튕겼다 —
 *     `API Error: 400 Claude Code 2.1.246 does not support this model;
 *      version 2.1.280 or newer is required. Run 'claude update' …`
 *   `isTransientFailure` 는 400 을 영구 오류로 배제하므로(그게 맞다) 이것은 `fail` 이 되고,
 *   세 번이면 회로가 차단된다. **그런데 우리 잘못이 아니고, 재시도로도 안 풀린다** —
 *   기계에 설치본이 둘 있었고(npm 2.1.246 · VS Code 확장 2.1.283) 우리만 낡은 것을 불렀다.
 *   제한·과부하·인증에서 세 번 고친 그 실패 방식의 네 번째 얼굴이다.
 *
 * 🔴 차단하지 않는 대신 **가장 시끄럽게 말한다.** 기다려서 낫는 일이 아니라 사람이
 *   고쳐야 하는 일이고, 고치기 전까지 재개는 한 번도 못 돈다(alerts 의 `CLI낡음`).
 *   지금은 `claudeBin()` 이 설치본 중 **가장 새것**을 고르므로 대개 저절로 맞는다.
 */
export function isOutdatedFailure(label) {
  const s = String(label || '')
  if (!s) return false
  if (/does not support this model/i.test(s) && /version\s+\d+\.\d+\.\d+\s+or newer/i.test(s)) return true
  if (/claude code \d+\.\d+\.\d+ does not support/i.test(s)) return true
  return /run '?claude update'?/i.test(s) && /version|newer|update/i.test(s)
}

/** 문구에서 «필요한 버전»·«우리 버전» 을 뽑는다 — 경보가 숫자를 그대로 보여줘야 한다 */
export function outdatedVersions(label) {
  const s = String(label || '')
  return {
    ours: (/claude code (\d+\.\d+\.\d+)/i.exec(s) || [])[1] || null,
    needed: (/version\s+(\d+\.\d+\.\d+)\s+or newer/i.exec(s) || [])[1] || null,
  }
}

/**
 * 실행 1회의 결과를 **하나의 이름**으로 정한다.
 *
 * 🔴 왜 함수로 떼어냈나 — 이 연쇄가 resume.mjs 안의 삼항식으로만 있어서 **시험이
 *   닿지 않았다.** 결과 이름 하나가 차단기를 태울지를 정하는데(fail 만 태운다) 그 판정이
 *   시험 밖에 있었다. 지금은 test/auth.test.mjs 가 다섯 갈래를 다 고정한다.
 *
 * 🔴 인증 칸이 **따로 있어야** 하는 이유: `isTransientFailure` 는 401 을 영구 오류로
 *   배제한다(그게 맞다 — 재시도로 안 풀리는 것이 많다). 그래서 인증 칸이 없으면
 *   401 은 'fail' 이 되고 세 번이면 차단된다. 실측한 그 사고다.
 *
 * 🔴 순서는 **좁은 것부터**다. 타임아웃이 먼저 — 30분을 실제로 돌았다는 뜻이고 그
 *   안에 어떤 문구가 섞여 있어도 기다리면 되는 일이 아니다. 제한이 인증보다 먼저 —
 *   둘이 섞이면 사람을 부르지 않는 쪽으로 기운다. 인증이 과부하보다 먼저 —
 *   5xx 와 인증 문구가 함께 오면 조용한 재시도보다 **말하는 쪽**이 안전하다.
 *
 * @param timedOut 타임아웃으로 강제 종료했는가
 * @param failed   실패로 볼 것인가 (exit≠0 · JSON 아님 · is_error)
 * @param label    요약 + stderr — 문구 판정의 재료
 * @returns {'timeout'|'ok'|'limited'|'auth'|'overload'|'fail'}
 */
export function classifyRun({ timedOut = false, failed = false, label = '' } = {}) {
  if (timedOut) return 'timeout'
  if (!failed) return 'ok'
  if (isLimitFailure(label)) return 'limited'   // 때가 아닌 것 — 저절로 풀린다
  // 🔴 CLI 낡음이 인증보다 먼저다 — 400 문구에 update·login 이 함께 오면 고칠 것은 버전이다
  if (isOutdatedFailure(label)) return 'outdated'
  if (isAuthFailure(label)) return 'auth'       // 전제가 사라진 것 — 경보로 올린다
  if (isTransientFailure(label)) return 'overload' // 저쪽이 흔들린 것
  return 'fail'                                 // 우리 잘못 — 이것만 차단기를 태운다
}
