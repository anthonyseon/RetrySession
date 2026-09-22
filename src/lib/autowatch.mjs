/**
 * autowatch.mjs — 설정된 저장소에서 **새로 뜬 세션에 감시를 붙인다.**
 *
 * 🔴 왜 (실측, 2026-09-22)
 *   세션 12개 중 8개가 등록되지 않은 채 돌고 있었다. 화면은 "세션 행에 짝지어지지
 *   않은 claude 프로세스"로 **보여주기만** 했다. 사람이 새 창을 열 때마다 손으로
 *   감시를 켜야 하고, 잊으면 그 세션은 멈춰도 아무도 모른다 —
 *   감시 장치를 켜는 일을 사람 기억에 맡기고 있었던 셈이다.
 *
 * 🔴 **감시만** 켠다. 재시작은 절대 자동으로 켜지 않는다.
 *   감시는 기록만 하므로 잘못 켜도 손해가 없다. 재시작은 돈을 쓰고 파일을 고친다 —
 *   그 스위치는 사람이 켠다. (claude-auto-retry 의 reconcile 도 붙이는 것은
 *   "감시"이지 "실행"이 아니다 — docs/claude-auto-retry.md §5)
 *
 * 🔴 **설정된 저장소 안에서만.** 기본은 꺼져 있다.
 *   `config/projects.json` 의 그 저장소가 `heartbeat.autoWatch: true` 라고
 *   말했을 때만 붙인다. 아무 폴더에서나 붙이면 남의 세션까지 등록부에 쌓인다.
 */
import { resolveRepo, setMany } from './targets.mjs'

/**
 * 누구에게 붙일지 **고르기만** 한다 — 순수 함수라 시험할 수 있다.
 *
 * 🔴 IO 와 분리해 둔다. 이 판정이 틀리면 남의 세션이 등록부에 쌓이거나,
 *   반대로 새 세션이 조용히 감시 없이 돈다. 둘 다 눈으로는 안 보인다.
 *
 * @param sessions fullStatus().sessions
 * @param resolve  cwd → {project, hasConfig} (시험에서 갈아끼운다)
 */
export function pickAutoWatch(sessions = [], resolve = resolveRepo) {
  const picked = []
  for (const s of sessions || []) {
    if (!s) continue
    // 이미 등록됐으면 건드리지 않는다 — 사람이 꺼둔 것을 되살리면 안 된다
    if (s.registered) continue
    // 돌고 있지 않으면 감시할 것이 없다. "모름"도 붙이지 않는다(fail-closed).
    if (!s.running || s.runKnown === false) continue
    const cwd = s.mainCwd || s.runCwd
    if (!cwd) continue
    const { project, hasConfig } = resolve(cwd) || {}
    // 설정에 없는 폴더는 대체 프로젝트로 잡힌다 — 거기까지 자동으로 붙이지 않는다
    if (!hasConfig || project?.heartbeat?.autoWatch !== true) continue
    picked.push(s)
  }
  return picked
}

/**
 * 골라서 **실제로 등록한다** (감시만).
 * @returns {{added:string[]}} 붙인 세션 id 들
 */
export function autoWatchNew(sessions = []) {
  const picked = pickAutoWatch(sessions)
  if (!picked.length) return { added: [] }

  const meta = {}
  for (const s of picked) {
    meta[s.sessionId] = { title: s.title, runCwd: s.runCwd, mainCwd: s.mainCwd, slug: s.slug }
  }
  setMany(picked.map((s) => s.sessionId), { watch: true }, meta)
  return { added: picked.map((s) => s.sessionId) }
}
