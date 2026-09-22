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
import { writeFileSync, appendFileSync, renameSync, statSync, existsSync, rmSync } from 'node:fs'

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
