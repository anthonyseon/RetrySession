/**
 * tracker.mjs — 실행추적기(07-실행추적.json)를 읽고 "어디서 멈췄나"를 판정한다.
 *
 * 재개규약 (추적기 자신이 _재개규약 에 적어둔 것과 같다)
 *   status 가 'doing' 인 항목이 중단 지점이다. 없으면 첫 'todo' 부터. doing 은 한 번에 하나만.
 *
 * 🔴 판정을 IO 와 분리한다.
 *   interpret() 는 순수 함수라서 시험할 수 있다. 감시 판정을 손으로 쓰다가
 *   fail-open 으로 9시간 중단을 놓친 실측 사고가 있었다 — 판정 코드는 시험으로 고정한다.
 */
import { readFileSync } from 'node:fs'

/**
 * 추적기 객체 → 재개에 필요한 요약.
 * @returns {{ok:boolean, 규약:string|null, doing:object|null, 다음todo:object|null,
 *            done:number, total:number, 완료표기:string, 남음:number,
 *            전부완료:boolean, nextAction:string|null, error:string|null}}
 */
export function interpret(obj) {
  const fail = (error) => ({
    ok: false, 규약: null, doing: null, 다음todo: null,
    done: 0, total: 0, 완료표기: '?', 남음: 0, 전부완료: false,
    nextAction: null, error,
  })

  if (!obj || typeof obj !== 'object') return fail('추적기가 객체가 아니다')
  if (!Array.isArray(obj.steps)) return fail('추적기에 steps 배열이 없다')

  const steps = obj.steps
  // 🔴 doing 은 한 번에 하나여야 한다. 둘 이상이면 규약 위반이므로 감추지 않고 알린다.
  const doings = steps.filter((s) => s.status === 'doing')
  const done = steps.filter((s) => s.status === 'done').length
  const todos = steps.filter((s) => s.status === 'todo')

  const trim = (v, n) => String(v ?? '').slice(0, n)
  const slim = (s) => s ? { id: s.id, title: trim(s.title, 120), evidence: trim(s.evidence, 200) } : null

  return {
    ok: true,
    규약: obj._재개규약 || null,
    doing: slim(doings[0]),
    doing위반: doings.length > 1 ? doings.map((s) => s.id) : null,
    다음todo: slim(todos[0]),
    done,
    total: steps.length,
    완료표기: `${done}/${steps.length}`,
    남음: steps.length - done,
    // 🔴 "doing·todo 가 없음" 으로 정의하면 안 된다. status 가 blocked 처럼 제3의 값이면
    //   done 이 아닌데도 완료로 판정되어, 막힌 일이 조용히 사라진다(시험이 잡은 결함).
    //   완료는 오직 전 단계가 done 일 때다.
    전부완료: done === steps.length && steps.length > 0,
    nextAction: obj.nextAction || null,
    error: null,
  }
}

/** 파일에서 읽어 판정한다. 읽기 실패도 판정 결과로 돌려준다(던지지 않는다) */
export function readTracker(path) {
  let obj
  try {
    obj = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return { ...interpret(null), error: `추적기를 읽을 수 없다 (${path}): ${e.message}` }
  }
  return interpret(obj)
}

/**
 * 헤드리스 재개에게 줄 지시문. 추적기가 말하는 것만 옮긴다 — 여기서 새 판단을 하지 않는다.
 *
 * 🔴 마지막 두 규칙이 안전장치다. 이 실행은 사람이 보고 있지 않다.
 */
export function resumePrompt(t, project) {
  const 현재 = t.doing
    ? `현재 doing: ${t.doing.id} — ${t.doing.title}\n근거: ${t.doing.evidence}`
    : t.다음todo
      ? `doing 없음. 첫 todo: ${t.다음todo.id} — ${t.다음todo.title}`
      : 'doing·todo 모두 없음'

  return [
    '당신은 중단된 작업을 이어서 재개한다. 이 실행은 OS 작업 스케줄러가 띄운 것이고 사람이 보고 있지 않다.',
    '',
    `진행 상태 정본: ${project.tracker}`,
    `재개규약: ${t.규약 || "status가 'doing'인 항목이 중단 지점이다. 없으면 첫 'todo'부터. doing은 한 번에 하나만."}`,
    '',
    현재,
    `완료: ${t.완료표기}`,
    t.nextAction ? `nextAction: ${t.nextAction}` : '',
    '',
    '규칙',
    '1. 먼저 추적기를 직접 읽어 현재 상태를 확인한다. 위 요약은 스케줄러가 뜬 시점의 것이라 낡았을 수 있다.',
    '2. doing 단계를 이어서 진행한다. 없으면 첫 todo 를 doing 으로 바꾸고 시작한다.',
    '3. 한 번에 한 단계만 한다. 끝내면 추적기의 status·evidence 를 갱신하고 커밋한다.',
    '4. 🔴 판단이 갈리는 지점에서는 멈춘다. 추적기 notes 에 무엇이 막혔는지 적고 끝낸다 — 추측으로 진행하지 않는다.',
    '5. 🔴 되돌리기 어려운 작업은 하지 않는다: force push · 브랜치 삭제 · 파일 대량 삭제 · 외부 전송·발행.',
    '6. 끝낼 때 무엇을 했는지 한 문단으로 요약한다. 그 요약이 재개 로그에 남는다.',
  ].filter((l) => l !== '').join('\n')
}
