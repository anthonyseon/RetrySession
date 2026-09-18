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
import { execSync } from 'node:child_process'

export const 작업이름 = {
  하트비트: 'EasyAI-RetrySession-Heartbeat',
  재시작: 'EasyAI-RetrySession-Resume',
  UI: 'EasyAI-RetrySession-UI',
  트레이: 'EasyAI-RetrySession-Tray',
}

/**
 * LastTaskResult 코드 → 사람이 읽는 뜻.
 * 실측으로 만난 값들이다 — 숫자만 보여주면 267009 가 오류인지 정상인지 알 수 없다.
 */
const 결과뜻 = (code) => {
  if (code === null || code === undefined) return null
  const n = Number(code)
  const 표 = {
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
  }
  if (표[n]) return 표[n]
  return `코드 ${n}` + (n < 0 || n > 1000 ? ` (0x${(n >>> 0).toString(16)})` : '')
}

/** 실패가 아닌 결과인가 — 화면에서 초록/노랑을 가르는 기준 */
const 정상결과 = (code) => [0, 267009, 267011, 267010].includes(Number(code))

const _cache = new Map()

function query() {
  const names = Object.values(작업이름)
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

  try {
    const out = execSync(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(out)
    return { ok: true, rows: Array.isArray(parsed) ? parsed : [parsed], 오류: null }
  } catch (e) {
    return { ok: false, rows: [], 오류: (e.stderr || e.message || '').toString().trim().slice(0, 300) || '조회 실패' }
  }
}

/**
 * 세 작업의 상태. 30초 캐시 — UI 가 몇 초마다 물어봐도 PowerShell 을 그만큼 띄우지 않게.
 * @returns {{하트비트:object, 재시작:object, UI:object, 캐시됨:boolean}}
 */
export function 작업상태({ ttlMs = 30000 } = {}) {
  const hit = _cache.get('tasks')
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.v, 캐시됨: true }

  const r = query()
  const byName = new Map(r.rows.map((x) => [x.name, x]))
  const v = {}
  for (const [키, name] of Object.entries(작업이름)) {
    const x = byName.get(name)
    if (!r.ok) {
      // 🔴 조회 실패를 "미등록"으로 답하지 않는다 — 있는 작업을 없다고 하면 엉뚱하게 재등록한다
      v[키] = { 이름: name, 조회실패: true, 등록됨: null, 오류: r.오류 }
      continue
    }
    if (!x || !x.registered) {
      v[키] = { 이름: name, 등록됨: false, 상태: null, 마지막실행: null, 마지막결과: null, 결과뜻: null, 정상: false, 오류: null }
      continue
    }
    v[키] = {
      이름: name,
      등록됨: true,
      상태: x.state || null,
      마지막실행: x.lastRun || null,
      마지막결과: x.lastResult ?? null,
      결과뜻: 결과뜻(x.lastResult),
      정상: 정상결과(x.lastResult),
      다음실행: x.nextRun || null,
      오류: null,
    }
  }
  _cache.set('tasks', { at: Date.now(), v })
  return { ...v, 캐시됨: false }
}

export function 캐시비우기() { _cache.clear() }
