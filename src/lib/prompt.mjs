/**
 * prompt.mjs — 재개할 때 **세션에 실제로 보내는 문장**.
 *
 * 🔴 왜 따로 뺐나
 *   `claude --resume <id> -p` 는 그 대화에 메시지를 한 줄 더 보내는 것이다.
 *   "멈춘 지점"이라는 북마크는 없다 — Claude 가 자기 대화를 다시 읽고 이 문장이
 *   시키는 대로 한다. 그래서 **이어가기의 품질은 곧 이 문장의 품질**이다.
 *   판정(resume.mjs 의 가드)과 이유가 다르고 같이 바뀌지 않으므로 나눈다.
 *   나눈 덕에 문장 자체를 시험할 수 있다.
 */
import { readTracker, resumePrompt } from './tracker.mjs'
import { trackerPath } from './targets.mjs'
/* ── 지시문 ──────────────────────────────────────────────────── */

/**
 * 재개 지시문. 세션을 이어받으므로 문맥 설명은 필요 없다 — **무엇을 계속할지와
 * 무인 실행의 한계**만 말한다.
 */
function buildPrompt(target, project, { limitStopped = false, interrupted = false } = {}) {
  // 왜 끊겼는지를 먼저 알린다 — 대화 마지막 줄이 시스템 알림이라, 설명 없이 두면
  // 그 알림을 자기 답으로 오해하고 무엇을 이어야 할지 헷갈린다.
  const head = limitStopped
    ? ['이 대화는 **사용량 제한에 걸려 중간에 끊겼다.** 제한은 이제 풀렸다.',
       '대화의 마지막 줄에 보이는 limit 알림은 네 답이 아니라 시스템 알림이다.', '']
    : interrupted
      ? ['이 대화는 **네 응답이 끝까지 전달되지 못한 채 끊겼다** (절전이나 연결 문제).',
         '대화의 마지막 줄에 보이는 `API Error: The response stopped arriving` 는 네 답이 아니라 시스템 알림이고,',
         '**그 바로 위의 네 답은 중간에 잘렸을 수 있다.** 이어 쓰기 전에 어디까지 실제로 반영됐는지 먼저 확인하라 —',
         '파일에 쓰다 말았을 수 있다. 다시 처음부터 하지 말고, 남은 부분만 끝내라.', '']
      : []

  if (target.resumePrompt) {
    return [
      '이 실행은 OS 작업 스케줄러가 띄운 것이고 사람이 보고 있지 않다. 아래 지시를 이어서 수행하라.',
      '',
      ...head,
      target.resumePrompt,
      '',
      ...safetyRules(),
    ].join('\n')
  }

  const tp = trackerPath(project)
  if (tp) {
    const body = resumePrompt(readTracker(tp), project)
    return head.length ? [...head, body].join('\n') : body
  }

  /**
   * 잘린 자리에서 이어가는 지시문.
   *
   * 🔴 이 갈래는 **제한중단이거나 끊김일 때만** 도달한다. 추적기도 재개지시도 없고
   *   둘 다 아니면 판정이 먼저 막는다 — 무엇을 이어서 할지 정해지지 않은 채로
   *   acceptEdits 권한의 무인 실행을 띄우지 않는다.
   *   (예전에는 여기에 범용 "이어서 진행하라"가 있었지만 도달할 수 없는 죽은 코드였다.)
   */
  return [
    '이 실행은 OS 작업 스케줄러가 띄운 것이고 사람이 보고 있지 않다.',
    ...head,
    '끊기기 직전에 하던 일 하나를 이어서 끝내라.',
    '',
    '1. 이 대화에서 마지막으로 **끝내지 못한** 일이 무엇인지 먼저 확인한다.',
    '2. 그 하나만 끝낸다. 새 작업을 시작하지 않는다.',
    '3. 끊기기 전에 이미 끝난 일이었다면 아무것도 하지 말고 그렇게 답하고 끝낸다.',
    ...safetyRules(),
  ].join('\n')
}

const safetyRules = () => ([
  '',
  '🔴 무인 실행 규칙',
  '- 판단이 갈리는 지점에서는 멈춘다. 무엇이 막혔는지 적고 끝낸다 — 추측으로 진행하지 않는다.',
  '- 되돌리기 어려운 작업은 하지 않는다: force push · 브랜치 삭제 · 파일 대량 삭제 · 외부 전송·발행.',
  '- 끝낼 때 무엇을 했는지 한 문단으로 요약한다. 그 요약이 재개 로그에 남는다.',
])


export { buildPrompt, safetyRules }
