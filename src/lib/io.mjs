/**
 * io.mjs — 상태 파일을 **찢어지지 않게** 쓰고, 로그를 **무한히 키우지 않게** 쓴다.
 *
 * 🔴 왜 원자 쓰기인가 (이 도구의 단일 실패점이었다)
 *   writeFileSync 는 자르고-쓰는 두 동작이다. 그 사이에 프로세스가 죽거나 전원이
 *   나가면 **반쯤 쓰인 JSON** 이 남는다. 그 파일이 state/targets.json 이면
 *   loadTargets() 가 던지고 — 일부러 그렇게 만들었다 — 하트비트와 재개가 **둘 다**
 *   멈춘다. 켜둔 감시가 통째로 사라지는데 아무도 알려주지 않는다.
 *   감시 장치가 자기 기록을 쓰다가 자기를 죽이면 안 된다.
 *
 *   임시 파일에 다 쓴 뒤 이름을 바꾼다. 이름 바꾸기는 원자적이라, 읽는 쪽은
 *   **옛 내용 아니면 새 내용**을 보고 그 사이는 없다.
 *
 * 🔴 왜 회전인가 (실측)
 *   heartbeat.log 는 5분마다 한 줄씩 쌓여 3일에 95KB 였다(2026-09-18~21).
 *   세션 하나당 연 11MB 다. 이 도구는 "계속 도는 것"이 목적이라 끝이 없다 —
 *   끝이 없는 것에 상한이 없으면 언젠가 디스크를 먹는다.
 */
import { writeFileSync, appendFileSync, renameSync, statSync, existsSync, rmSync, readFileSync } from 'node:fs'

/**
 * 원자적으로 쓴다. 같은 폴더의 임시 파일에 쓰고 이름을 바꾼다.
 *
 * 같은 폴더를 쓰는 이유: 이름 바꾸기가 원자적인 것은 **같은 볼륨 안에서만**이다.
 * %TEMP% 에 쓰고 옮기면 볼륨이 갈릴 수 있고, 그러면 복사-삭제로 떨어져 원자성이 깨진다.
 *
 * 이름 바꾸기가 실패할 수 있는 경우(백신이 파일을 잡고 있는 등)를 위해 몇 번 다시 시도한다.
 * 끝내 실패하면 **던진다** — 조용히 직접 쓰기로 물러서면 막으려던 찢어짐이 되돌아온다.
 */
export function writeAtomic(path, text, { tried = 5 } = {}) {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, text)
  let lastError = null
  for (let i = 0; i < tried; i++) {
    try {
      renameSync(tmp, path)   // 덮어쓴다 — 읽는 쪽은 옛것 아니면 새것을 본다
      return
    } catch (e) {
      lastError = e
      // 아주 짧게 기다린다. 동기 함수라 타이머를 쓸 수 없다.
      const end = Date.now() + 20
      while (Date.now() < end) { /* 잠깐 양보 */ }
    }
  }
  try { rmSync(tmp, { force: true }) } catch { /* 지우지 못해도 본 오류가 중요하다 */ }
  throw lastError
}

/** 객체를 원자적으로 JSON 으로 */
export const writeJsonAtomic = (path, obj) => writeAtomic(path, JSON.stringify(obj, null, 2) + '\n')

/**
 * 로그에 한 줄 덧붙인다. 한계를 넘으면 `.1` 로 밀고 새로 시작한다.
 *
 * 두 세대만 남긴다. 더 남겨봐야 아무도 읽지 않고, 화면은 어차피 꼬리
 * 64KB 만 읽는다(status.mjs 의 tail). 상한이 있다는 사실이 중요하다.
 */
export function appendLine(path, text, { maxBytes = 2 * 1024 * 1024 } = {}) {
  const line = text.endsWith('\n') ? text : text + '\n'
  try {
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > maxBytes) {
      try { rmSync(`${path}.1`, { force: true }) } catch { /* 없으면 됐다 */ }
      renameSync(path, `${path}.1`)
    }
  } catch { /* 회전 실패가 기록을 막지 않는다 — 기록이 회전보다 중요하다 */ }
  appendFileSync(path, line)
}

/**
 * 같은 이유가 이어질 때 **마지막 줄을 접는다** (덧붙이지 않고 고쳐 쓴다).
 *
 * 🔴 왜 (실측, 2026-09-22)
 *   재개 로그가 15분마다 똑같은 줄을 쌓았다 — 21회차가 전부
 *   `SKIP · 세션이 실행 중이다 (pid 4084)` 였다. 사람이 열어 보면 스무 줄을 넘겨야
 *   **달라진 한 줄**에 닿는다. 그러면 로그를 안 읽게 되고, 안 읽는 기록은 없는 것과 같다.
 *
 * 🔴 그렇다고 **줄이면 안 된다.** "기록이 없다"와 "같은 이유로 계속 건너뛰는 중"은
 *   전혀 다른 상태다. 그래서 지우는 게 아니라 접는다 — 횟수와 처음 시각을 남긴다.
 *
 * 🔴 `sameKey` 는 줄의 **끝**과 맞춰 본다. 접은 줄은 머리가 바뀌므로(`SKIP` → `SKIP ×2`)
 *   머리로 맞추면 세 번째부터 접히지 않는다 — 실제로 그렇게 짜서 ×2 에서 멈췄다.
 *
 * @param sameKey 같은 이유인지 가리는 열쇠. 줄 **끝**이 이것이면 접는다.
 * @returns {boolean} 접었으면 true, 새로 덧붙였으면 false
 */
export function appendOrFold(path, { sameKey, line, folded }) {
  try {
    if (!existsSync(path) || statSync(path).size > 4 * 1024 * 1024) { appendLine(path, line); return false }
    const body = readFileSync(path, 'utf8')
    const lines = body.split('\n')
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    const last = lines[lines.length - 1]
    if (!last || !last.endsWith(sameKey)) { appendLine(path, line); return false }

    // 이미 접힌 줄이면 횟수를 이어 센다. 처음 시각은 **처음 것을 지킨다.**
    const m = last.match(/×(\d+) \(처음 ([^)]+)\)/)
    const count = m ? Number(m[1]) + 1 : 2
    const firstAt = m ? m[2] : (last.split(' · ')[0] || '?')
    lines[lines.length - 1] = folded({ count, firstAt })
    writeFileSync(path, lines.join('\n') + '\n')
    return true
  } catch {
    // 접기에 실패하면 그냥 덧붙인다 — 기록이 접기보다 중요하다
    try { appendLine(path, line) } catch { /* 기록 실패가 판정을 막지는 않는다 */ }
    return false
  }
}
