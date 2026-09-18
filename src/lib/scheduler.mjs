/**
 * scheduler.mjs — Windows 작업 스케줄러에 우리 작업이 등록돼 있는지 본다.
 *
 * 왜 이것이 상태 화면에 있어야 하나
 *   원본 사고의 교훈이다. 하트비트 기록이 없을 때 원인은 둘 중 하나다 —
 *   ① 작업이 등록돼 있는데 실패하고 있다  ② 작업 자체가 사라졌다.
 *   둘은 대처가 다르다(재시작 vs 재등록). 그런데 기록만 보면 구별할 수 없다.
 *   그래서 등록 상태를 따로 읽어 화면에 나란히 놓는다.
 *
 * `schtasks` 를 쓴다 — PowerShell 모듈보다 빠르고 어느 Windows 에나 있다.
 */
import { execSync } from 'node:child_process'

export const 작업이름 = {
  하트비트: 'EasyAI-RetrySession-Heartbeat',
  재시작: 'EasyAI-RetrySession-Resume',
  UI: 'EasyAI-RetrySession-UI',
}

const _cache = new Map()

/**
 * 작업 하나의 등록·실행 상태.
 * @returns {{등록됨:boolean, 상태:string|null, 마지막실행:string|null,
 *            마지막결과:string|null, 다음실행:string|null, 오류:string|null}}
 */
function query1(name) {
  try {
    // /FO LIST 는 `키: 값` 줄로 나온다. 로케일에 따라 키 이름이 한글일 수 있으므로
    // /V(상세) + 위치가 아니라 **여러 후보 키**로 찾는다.
    const out = execSync(`schtasks /Query /TN "${name}" /FO LIST /V`, {
      encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const get = (...keys) => {
      for (const line of out.split('\n')) {
        const i = line.indexOf(':')
        if (i < 0) continue
        const k = line.slice(0, i).trim()
        if (keys.some((c) => k === c)) return line.slice(i + 1).trim()
      }
      return null
    }
    return {
      등록됨: true,
      상태: get('Status', '상태'),
      마지막실행: get('Last Run Time', '마지막 실행 시간'),
      마지막결과: get('Last Result', '마지막 결과'),
      다음실행: get('Next Run Time', '다음 실행 시간'),
      오류: null,
    }
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString()
    // 작업이 없을 때도 exit≠0 이다 — "없음"과 "조회 실패"를 구별한다
    const 없음 = /cannot find|does not exist|찾을 수 없|없습니다/i.test(msg)
    return {
      등록됨: false, 상태: null, 마지막실행: null, 마지막결과: null, 다음실행: null,
      오류: 없음 ? null : msg.trim().slice(0, 300) || '조회 실패',
    }
  }
}

/** 세 작업의 상태. 30초 캐시 — UI 가 몇 초마다 물어봐도 schtasks 를 그만큼 띄우지 않게 */
export function 작업상태({ ttlMs = 30000 } = {}) {
  const hit = _cache.get('tasks')
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.v, 캐시됨: true }
  const v = {}
  for (const [키, name] of Object.entries(작업이름)) v[키] = { 이름: name, ...query1(name) }
  _cache.set('tasks', { at: Date.now(), v })
  return { ...v, 캐시됨: false }
}

export function 캐시비우기() { _cache.clear() }
