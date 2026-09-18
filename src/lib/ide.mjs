/**
 * ide.mjs — VS Code 에서 열려 있는 워크스페이스를 읽는다.
 *
 * 어디서 읽는가 (실측)
 *   `~/.claude/ide/<port>.lock` — VS Code 확장이 남기는 연동 정보다. 파일 하나가
 *   창 하나이고, 파일 이름의 숫자가 WebSocket 포트다(포트 63788 이 LISTENING 인 것을 확인).
 *     { pid, workspaceFolders[], ideName, transport, runningInWindows, authToken }
 *
 * 🔴 authToken 은 절대 내보내지 않는다.
 *   이 값으로 IDE 연동에 붙을 수 있다. 상태 화면은 로컬 전용이지만, 비밀은 필요 없는
 *   곳으로 흐르지 않게 **읽는 즉시 버린다** — 응답에 담아두면 로그·캡처로 새어나간다.
 *
 * 🔴 낡은 lock 이 남는다.
 *   실측: pid 27076 짜리 lock 이 9일 전 것으로 남아 있었고 그 프로세스는 죽어 있었다.
 *   pid 생존을 확인해 "열려 있는 창"과 "남은 흔적"을 구별한다 — 구별하지 않으면
 *   닫은 창이 열린 것처럼 보인다.
 *
 * 왜 이것이 필요한가
 *   "Description 세션이 목록에 없다"는 물음의 답이 여기 있다. Description 은 VS Code 에
 *   **폴더로 열려 있지만** 그 폴더에서 시작된 세션이 없을 수 있다. 세션 목록만 보면
 *   둘을 구별할 수 없다 — 열린 폴더와 세션을 나란히 놓아야 설명이 된다.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { claudeHome, 경로키, 안에있나 } from './config.mjs'
import { localStamp, minutesSince } from './stamp.mjs'

/** pid 가 살아있나. 신호 0 은 아무것도 보내지 않고 존재만 확인한다 */
const 살아있나 = (pid) => {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * 열려 있는(그리고 남아 있는) IDE 창 목록.
 * @returns {{창:Array, 오류:string|null}}
 */
export function ideWindows() {
  const home = claudeHome()
  if (!home) return { 창: [], 오류: '홈 디렉터리를 찾을 수 없다' }
  const dir = join(home, 'ide')
  if (!existsSync(dir)) return { 창: [], 오류: null }

  const 창 = []
  let 오류 = null
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.lock')) continue
      const path = join(dir, f)
      let j, st
      try {
        st = statSync(path)
        j = JSON.parse(readFileSync(path, 'utf8'))
      } catch { continue } // 쓰는 중이면 깨질 수 있다 — 다음 회차에 잡힌다

      const 포트 = Number(f.replace(/\.lock$/, '')) || null
      const alive = 살아있나(j.pid)

      창.push({
        포트,
        pid: j.pid ?? null,
        ideName: j.ideName || null,
        transport: j.transport || null,
        workspaceFolders: (j.workspaceFolders || []).map(경로키),
        살아있음: alive,
        낡음: !alive, // 프로세스가 없으면 닫힌 창의 흔적이다
        기록시각: localStamp(st.mtime),
        기록_분전: Math.round(minutesSince(st.mtime.getTime())),
        // 🔴 authToken 은 여기 담지 않는다 (위 주석 참조)
      })
    }
  } catch (e) {
    오류 = e.message
  }

  // 살아있는 창을 먼저, 그 안에서는 최근 것 먼저
  창.sort((a, b) => (b.살아있음 - a.살아있음) || (b.기록_분전 < a.기록_분전 ? 1 : -1))
  return { 창, 오류 }
}

/**
 * 이 경로가 어느 IDE 창에 열려 있나. 살아있는 창만 본다.
 * 여러 창에 걸쳐 있으면 **가장 구체적인**(가장 긴) 폴더로 짝지은 창을 돌려준다.
 */
export function 창찾기(cwd, 창목록) {
  if (!cwd) return null
  let best = null, bestLen = -1
  for (const w of 창목록) {
    if (!w.살아있음) continue
    for (const f of w.workspaceFolders) {
      if (안에있나(cwd, f) && f.length > bestLen) { best = w; bestLen = f.length }
    }
  }
  return best ? { 포트: best.포트, pid: best.pid, ideName: best.ideName, 폴더: bestLen >= 0 ? best.workspaceFolders.find((f) => 안에있나(cwd, f)) : null } : null
}

/**
 * 열린 폴더별로 "여기서 시작된 세션이 있나"를 센다.
 *
 * 이것이 "Description 이 목록에 없다"의 답을 만든다 — 폴더는 열려 있는데 세션이 0개면
 * 그 폴더에서 Claude Code 를 시작한 적이 없다는 뜻이고, 그건 빠뜨린 것이 아니다.
 */
export function 폴더별세션(창목록, 세션들) {
  const out = []
  for (const w of 창목록) {
    if (!w.살아있음) continue
    for (const f of w.workspaceFolders) {
      const 해당 = 세션들.filter((s) =>
        안에있나(s.실행cwd || '', f) || 안에있나(s.주작업cwd || '', f))
      out.push({
        폴더: f,
        포트: w.포트,
        ideName: w.ideName,
        세션수: 해당.length,
        실행중: 해당.filter((s) => s.실행중).length,
        감시: 해당.filter((s) => s.감시?.켜짐).length,
        // 이 폴더를 **시작 위치**로 쓴 세션이 있나 (주작업으로만 쓴 것과 구별한다)
        여기서시작: 해당.filter((s) => 안에있나(s.실행cwd || '', f)).length,
        sessionIds: 해당.map((s) => s.sessionId),
      })
    }
  }
  // 같은 폴더가 여러 창에 열려 있으면 하나로 합친다
  const 병합 = new Map()
  for (const r of out) {
    const k = r.폴더.toLowerCase()
    const p = 병합.get(k)
    if (!p) 병합.set(k, r)
    else {
      p.세션수 = Math.max(p.세션수, r.세션수)
      p.포트 = `${p.포트}, ${r.포트}`
    }
  }
  return [...병합.values()].sort((a, b) => b.세션수 - a.세션수 || a.폴더.localeCompare(b.폴더))
}
