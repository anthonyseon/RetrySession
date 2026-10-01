/**
 * scheduler.mjs — Windows 작업 스케줄러에 우리 작업이 등록돼 있는지 본다.
 *
 * 왜 이것이 상태 화면에 있어야 하나
 *   원본 사고의 교훈이다. 기록이 없을 때 원인은 둘 중 하나다 —
 *   ① 작업이 등록돼 있는데 실패하고 있다  ② 작업 자체가 사라졌다.
 *   둘은 대처가 다르다(재시작 vs 재등록). 기록만 보면 구별할 수 없으므로
 *   등록 상태를 따로 읽어 화면에 나란히 놓는다.
 *
 * 🔴 왜 schtasks 가 아니라 PowerShell 인가 (실측)
 *   `schtasks /Query /FO LIST` 는 **콘솔 코드페이지**로 출력한다. 한글 Windows 에서는
 *   cp949 라서 UTF-8 로 읽으면 키 이름이 깨지고, `상태:` `마지막 실행 시간:` 같은
 *   줄을 하나도 못 찾는다(등록 여부만 맞고 나머지가 전부 null 이 됐다).
 *   `Get-ScheduledTask` 의 **속성 이름은 로케일과 무관하게 영어**다. 그래서 그쪽을 쓴다.
 *   한 번의 호출로 세 작업을 다 읽어 프로세스 기동 비용을 한 번만 낸다.
 */
import { execSync, spawn } from 'node:child_process'

export const taskNames = {
  heartbeat: 'EasyAI-RetrySession-Heartbeat',
  restart: 'EasyAI-RetrySession-Resume',
  UI: 'EasyAI-RetrySession-UI',
  tray: 'EasyAI-RetrySession-Tray',
}

/**
 * LastTaskResult 코드 → 사람이 읽는 뜻.
 * 실측으로 만난 값들이다 — 숫자만 보여주면 267009 가 오류인지 정상인지 알 수 없다.
 */
const resultText = (code) => {
  if (code === null || code === undefined) return null
  const n = Number(code)
  const table = {
    0: '성공',
    1: '오류(1) — 잘못된 함수 호출',
    2: '오류(2) — 파일을 찾을 수 없음. 우리 쪽에서는 UI 포트 충돌일 수 있다',
    267009: '실행 중',          // 0x00041301 SCHED_S_TASK_RUNNING
    267010: '실행 예정 없음',    // 0x00041302
    267011: '아직 실행되지 않음', // 0x00041303 SCHED_S_TASK_HAS_NOT_RUN
    267012: '트리거 시각 지남',
    267014: '사용자가 종료함',   // 0x00041306 SCHED_S_TASK_TERMINATED
    2147750687: '이미 실행 중이라 새 실행을 건너뜀', // 0x800704DF
    3221225786: '중지 신호로 종료(Stop-ScheduledTask 등)', // 0xC000013A STATUS_CONTROL_C_EXIT
    3221225794: '시작 실패 — DLL 초기화 오류',              // 0xC0000142
    // 🔴 실측 (2026-09-21): 사용자가 "예약 작업이 실패로 끝났습니다 / 트레이 —
    //   코드 4294967295" 를 보고했다. 표에 없어서 숫자만 나왔고, 숫자만으로는
    //   고장인지 아닌지 알 수 없다.
    //   정체는 우리 자신이다. `Stop-Process -Force` 는 TerminateProcess(h, -1) 로
    //   죽이고, -1 을 부호 없는 32비트로 읽은 것이 4294967295 다. 즉 start.ps1 의
    //   `-Stop`·`-Restart` 가 남기는 **정상 종료 기록**이다.
    4294967295: '강제 종료됨(-1) — start.ps1 -Stop/-Restart 가 이렇게 끝낸다',
  }
  if (table[n]) return table[n]
  return `코드 ${n}` + (n < 0 || n > 1000 ? ` (0x${(n >>> 0).toString(16)})` : '')
}

/** 실패가 아닌 결과인가 — 화면에서 초록/노랑을 가르는 기준 */
const isOkResult = (code) => [0, 267009, 267011, 267010].includes(Number(code))

/**
 * **사람이 멈춘** 결과인가. 고장과 구별해야 한다.
 *
 * 🔴 왜 나누나
 *   멈춘 것과 실패한 것은 대처가 다르다 — 전자는 "다시 띄워라", 후자는 "원인을 찾아라".
 *   둘을 같은 문구로 말하면 사람은 둘 다 무시하게 된다. 이 저장소가 계속 겪은
 *   그 실패(느린 것을 죽었다고 하기 · 멀쩡한 것을 응답 없다고 하기)와 같은 부류다.
 */
const isStoppedResult = (code) => [267014, 3221225786, 4294967295].includes(Number(code))

/** 지금 돌고 있는가. 오래 사는 작업(UI·트레이)은 이게 마지막 결과보다 중요하다 */
const isRunningState = (state) => /^running$/i.test(String(state || '').trim())

const _cache = new Map()

/** PowerShell 한 줄. 동기·비동기 두 길이 **같은 명령**을 쓴다 (두 벌로 만들지 않는다) */
function psCommand() {
  const names = Object.values(taskNames)
  const list = names.map((n) => `'${n}'`).join(',')
  // 날짜는 고정 형식으로 찍는다 — 로케일 날짜 문자열은 파싱도 표시도 불안정하다
  const ps = [
    `$ErrorActionPreference='SilentlyContinue';`,
    `$out=@();`,
    `foreach($n in @(${list})){`,
    `  $t=Get-ScheduledTask -TaskName $n;`,
    `  if($t){`,
    `    $i=Get-ScheduledTaskInfo -TaskName $n;`,
    `    $lr=if($i.LastRunTime -and $i.LastRunTime.Year -gt 2000){$i.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss')}else{$null};`,
    `    $nr=if($i.NextRunTime -and $i.NextRunTime.Year -gt 2000){$i.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss')}else{$null};`,
    `    $out+=[pscustomobject]@{name=$n;registered=$true;state=[string]$t.State;lastRun=$lr;lastResult=$i.LastTaskResult;nextRun=$nr}`,
    `  } else { $out+=[pscustomobject]@{name=$n;registered=$false} }`,
    `};`,
    `ConvertTo-Json -InputObject @($out) -Compress -Depth 3`,
  ].join(' ')
  return ps
}

const parseOut = (out) => {
  const parsed = JSON.parse(out)
  return { ok: true, rows: Array.isArray(parsed) ? parsed : [parsed], error: null }
}
const toQueryError = (e) => ({
  ok: false, rows: [],
  error: (e.stderr || e.message || '').toString().trim().slice(0, 300) || '조회 실패',
})

function query() {
  const ps = psCommand()
  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    return parseOut(out)
  } catch (e) {
    return toQueryError(e)
  }
}

/**
 * 같은 조회를 **막지 않고** 한다. 결과는 캐시에만 넣는다 — 부르는 쪽은 기다리지 않는다.
 * 한 번에 하나만 돈다(겹쳐 띄우면 PowerShell 이 쌓인다).
 */
let _refreshing = null
function refreshAsync() {
  if (_refreshing) return _refreshing
  _refreshing = new Promise((resolve) => {
    const ps = psCommand()
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('error', () => { _refreshing = null; resolve(false) })
    child.on('close', () => {
      _refreshing = null
      try { _cache.set('tasks', { at: Date.now(), v: buildTaskTable(parseOut(out)) }); resolve(true) } catch { resolve(false) /* 다음 회차에 다시 */ }
    })
    // 응답을 붙잡지 않는다 — 서버 종료를 막아서도 안 된다
    child.unref?.()
  })
  return _refreshing
}

/**
 * 지금 다시 읽고 **끝날 때까지 기다린다** — 이벤트 루프는 막지 않는다.
 *
 * 🔴 작업을 막 등록한 쪽(«이 PC 준비하기»)이 쓴다. 캐시를 비우면(`clearCache`) 다음 조회가
 *   **동기**로 7초를 막는다(위 taskState 머리말의 실측) — 그동안 /api/ping 이 멈춘다.
 *   그래서 비우지 않고 비동기로 새로 읽어 캐시를 갈아 끼운다. 이미 읽는 중이면 그것을 기다린다.
 */
export const refreshTasks = () => refreshAsync()

/**
 * 네 작업의 상태. 30초 캐시 — UI 가 몇 초마다 물어봐도 PowerShell 을 그만큼 띄우지 않는다.
 * @returns {{heartbeat:object, restart:object, UI:object, tray:object, cached:boolean, stale?:boolean, ageMs:number}}
 *
 * 🔴 낡았으면 **낡은 값을 먼저 주고 뒤에서 새로 읽는다.**
 *
 *   실측 (2026-09-22): 이 조회 한 번이 **7.0초**다. PowerShell 기동 + ScheduledTasks
 *   모듈 적재가 대부분이고, 네 작업을 한 번에 물어도 줄지 않는다. 그런데 이 함수는
 *   동기다 — 그동안 node 의 이벤트 루프가 통째로 멈춘다. 그래서 아무것도 계산하지
 *   않는 `/api/ping` 이 최대 **7.9초**가 걸렸다(실측 분포: 평소 17~20ms).
 *
 *   /api/ping 은 start.ps1·register-ui.ps1·open-app.ps1 이 **5초 제한**으로 살아있음을
 *   판정하는 자리다. 멀쩡한 서버가 "응답 없음"이 되고, 그 판정 때문에 트레이가 아예
 *   안 뜬 적이 있다(이 저장소가 이미 한 번 겪은 사고다).
 *
 *   그래서 캐시가 있으면 그것을 즉시 돌려주고, 갱신은 자식 프로세스를 **비동기로**
 *   띄워 받아둔다. 값이 아예 없을 때만(=서버가 막 떴을 때) 동기로 기다린다.
 *   낡음은 `나이ms` 로 정직하게 알린다 — 조용히 오래된 값을 주지 않는다.
 */
export function taskState({ ttlMs = 30000 } = {}) {
  const hit = _cache.get('tasks')
  if (hit && Date.now() - hit.at < ttlMs) {
    return { ...hit.v, cached: true, ageMs: Date.now() - hit.at }
  }
  if (hit) {
    refreshAsync()
    return { ...hit.v, cached: true, stale: true, ageMs: Date.now() - hit.at }
  }

  const v = buildTaskTable(query())
  _cache.set('tasks', { at: Date.now(), v })
  return { ...v, cached: false, ageMs: 0 }
}

/**
 * `taskState()` 결과에서 **진짜 작업만** 골라낸다.
 *
 * 🔴 왜 따로 두나 (실측 결함, 2026-09-22)
 *   `taskState()` 는 작업 넷에 캐시 사정(`cached`·`stale`·`ageMs`)을 **같은 평면에**
 *   섞어 돌려준다. 그래서 `Object.entries(tasks)` 를 그냥 돌면 `cached` 를 다섯째
 *   작업으로 세게 된다. 경보와 트레이가 각자 `키 !== '캐시됨'` 으로 막고 있었는데,
 *   이름을 영어로 바꾸면서 그 키가 `cached` 가 되자 **두 곳의 방패가 동시에 헛돌았다.**
 *   지금은 값이 전부 원시형이라 우연히 조용했을 뿐이다 — 캐시 사정에 객체 하나만
 *   늘면 없는 작업이 경보로 튀어나온다.
 *
 *   막는 규칙을 두 벌 만들지 않는다. 여기 한 곳에서만 판단한다. 그리고 "작업이
 *   아닌 것"을 값 모양으로 알아맞히지 않는다 — **작업 이름은 이미 알고 있다.**
 *   아는 것으로 고르면 뒤에 무엇이 더 붙든 흔들리지 않는다.
 */
export const taskEntries = (tasks) =>
  Object.keys(taskNames).filter((k) => tasks?.[k]).map((k) => [k, tasks[k]])

/** 조회 결과 → 작업별 판정. 순수 함수 (동기·비동기 두 길이 함께 쓴다) */
function buildTaskTable(r) {
  const byName = new Map(r.rows.map((x) => [x.name, x]))
  const v = {}
  for (const [key, name] of Object.entries(taskNames)) {
    const x = byName.get(name)
    if (!r.ok) {
      // 🔴 조회 실패를 "미등록"으로 답하지 않는다 — 있는 작업을 없다고 하면 엉뚱하게 재등록한다
      v[key] = { name: name, queryFailed: true, registered: null, error: r.error }
      continue
    }
    if (!x || !x.registered) {
      v[key] = { name: name, registered: false, state: null, lastRun: null, lastResult: null, resultText: null, healthy: false, error: null }
      continue
    }
    /**
     * 🔴 "지금 돌고 있나"가 "지난 회차가 어떻게 끝났나"를 이긴다.
     *
     *   마지막 결과는 **이미 끝난 회차**를 설명한다. 오래 사는 작업(UI·트레이)을
     *   사람이 재시작하면 그 기록은 강제 종료(-1)로 남는데, 지금 멀쩡히 돌고 있다면
     *   그건 고장이 아니다. 실측: start.ps1 -Restart 한 뒤 "예약 작업이 실패로
     *   끝났습니다 / 코드 4294967295" 경보가 떴고, 그때 트레이는 정상 기동해 있었다.
     */
    const isRunning = isRunningState(x.state)
    const stopped = isStoppedResult(x.lastResult)
    v[key] = {
      name: name,
      registered: true,
      state: x.state || null,
      isRunning,
      lastRun: x.lastRun || null,
      lastResult: x.lastResult ?? null,
      resultText: resultText(x.lastResult),
      // 돌고 있으면 정상이다. 아니면 마지막 결과로 판정한다.
      // ⚠ 이것은 **작업**이 정상이라는 뜻이지 **서비스가 응답한다**는 뜻이 아니다 —
      //   "등록됨"과 "서비스 중"의 구별은 이 저장소의 핵심 교훈이다(/api/ping 이 그쪽을 본다).
      healthy: isRunning || isOkResult(x.lastResult),
      // 멈춘 것인가 고장인가 — 대처가 다르므로 화면·경보가 다른 문구를 쓴다
      stopped: !isRunning && stopped,
      nextRun: x.nextRun || null,
      error: null,
    }
  }
  return v
}

export function clearCache() { _cache.clear() }
