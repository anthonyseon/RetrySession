/**
 * single.mjs — 구성요소마다 프로세스를 하나만 돌게 한다.
 *
 * 왜 필요한가
 *   같은 것이 둘 돌면 서로를 밟는다:
 *     · 하트비트 둘 → 같은 heartbeat.json 을 동시에 덮어써 기록이 찢어진다
 *     · 재시작 둘  → 같은 워킹트리를 고치고, 하루 예산을 두 배로 쓴다
 *     · UI 둘      → 포트를 다투다 하나가 죽고, 사람은 낡은 화면을 본다
 *   예약 작업에는 `MultipleInstances IgnoreNew` 가 걸려 있지만 그것은 **스케줄러가
 *   띄우는 것끼리만** 막는다. 사람이 손으로 돌리거나 트레이·화면에서 "지금 실행"을
 *   누르면 예약 실행과 겹칠 수 있다. 그 구멍을 여기서 막는다.
 *
 * 왜 파일 락인가
 *   Node 는 네이티브 모듈 없이 Windows 명명 뮤텍스를 쓸 수 없다(트레이는 PowerShell 이라
 *   쓸 수 있었다). 대신 pid 를 적은 락 파일을 쓴다 — **pid 생존과 시간 한계를 둘 다**
 *   본다. pid 는 재사용되므로 그것만 믿을 수 없고, 시간만 보면 멀쩡히 도는 것을 밀어낸다.
 *
 * 🔴 중복은 오류가 아니다.
 *   이미 돌고 있어서 안 도는 것은 정상이다. exit 0 으로 끝낸다 — 1 로 끝내면
 *   작업 스케줄러 이력이 빨갛게 물들어 진짜 실패를 가린다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME } from './config.mjs'
import { localStamp, minutesSince } from './stamp.mjs'

const 락폴더 = () => {
  const d = join(RS_HOME, 'state', 'locks')
  mkdirSync(d, { recursive: true })
  return d
}

export const 락경로 = (이름) => join(락폴더(), `${이름}.lock`)

/** pid 가 살아있나. 신호 0 은 아무것도 보내지 않고 존재만 확인한다 */
const 살아있나 = (pid) => {
  if (!pid || pid === process.pid) return pid === process.pid
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * 락을 들여다본다(잡지 않는다). 상태 화면이 중복을 보고할 때 쓴다.
 * @returns {{점유:boolean, pid:number|null, at:string|null, 나이분:number|null, 낡음:boolean}}
 */
export function 락상태(이름, 낡음분 = 60) {
  const p = 락경로(이름)
  if (!existsSync(p)) return { 점유: false, pid: null, at: null, 나이분: null, 낡음: false }
  let h = null
  try { h = JSON.parse(readFileSync(p, 'utf8')) } catch { /* 깨진 락은 낡은 것으로 본다 */ }
  const 나이분 = h?.atEpoch ? Math.round(minutesSince(h.atEpoch)) : null
  const alive = 살아있나(h?.pid)
  const 낡음 = !alive || (나이분 !== null && 나이분 >= 낡음분)
  return { 점유: alive && !낡음, pid: h?.pid ?? null, at: h?.at ?? null, 나이분, 낡음 }
}

/**
 * 잡거나 실패한다. 잡으면 프로세스가 끝날 때 자동으로 푼다.
 *
 * @param 이름 구성요소 이름 (heartbeat · resume · ui)
 * @param 낡음분 이 시간을 넘긴 락은 회수한다. 오래 도는 것일수록 크게 준다.
 * @returns {{ok:boolean, why:string|null, 이전:object|null}}
 */
export function 잡기(이름, { 낡음분 = 60 } = {}) {
  const p = 락경로(이름)

  if (existsSync(p)) {
    const s = 락상태(이름, 낡음분)
    if (s.점유) {
      return {
        ok: false,
        why: `이미 돌고 있다 (pid ${s.pid}, ${s.at ?? '?'} 시작${s.나이분 !== null ? `, ${s.나이분}분 전` : ''})`,
        이전: s,
      }
    }
    // 여기까지 오면 회수한다 — 죽은 프로세스이거나 한계를 넘겼다
  }

  writeFileSync(p, JSON.stringify({
    이름, pid: process.pid, at: localStamp(), atEpoch: Date.now(),
    argv: process.argv.slice(2).join(' '),
  }, null, 2) + '\n')

  // 🔴 끝날 때 반드시 푼다. 안 풀면 다음 실행이 낡음분을 기다려야 한다.
  //   강제 종료(taskkill /F)는 잡을 수 없지만, 그때는 pid 생존 확인이 받아낸다.
  let 풀림 = false
  const 풀기 = () => {
    if (풀림) return
    풀림 = true
    try {
      // 내 것일 때만 지운다 — 남의 락을 지우면 중복을 허용하게 된다
      const h = JSON.parse(readFileSync(p, 'utf8'))
      if (h.pid === process.pid) rmSync(p, { force: true })
    } catch { /* 이미 없거나 못 읽으면 둔다 */ }
  }
  process.on('exit', 풀기)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(sig, () => { 풀기(); process.exit(0) })
  }

  return { ok: true, why: null, 이전: null }
}

/**
 * 잡거나 **조용히 끝낸다**. 스크립트 맨 앞에서 한 줄로 쓰는 용도.
 *
 * 🔴 exit 0 이다 — 중복은 실패가 아니다(파일 머리 주석 참조).
 */
export function 단일실행(이름, { 낡음분 = 60, 조용히 = false } = {}) {
  const r = 잡기(이름, { 낡음분 })
  if (!r.ok) {
    if (!조용히) console.log(`⛔ ${이름}: ${r.why} — 이번 실행은 건너뛴다`)
    process.exit(0)
  }
  return r
}

/** 모든 구성요소의 락 상태 — 화면에서 중복·유령 락을 보여준다 */
export function 전체락상태() {
  const 한계 = { heartbeat: 30, resume: 90, ui: 24 * 60 }
  const out = {}
  for (const [이름, 낡음분] of Object.entries(한계)) {
    out[이름] = { ...락상태(이름, 낡음분), 낡음한계분: 낡음분 }
  }
  return out
}
