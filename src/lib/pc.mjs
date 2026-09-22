/**
 * pc.mjs — RetrySession 이 돌기 위한 **PC 설정** 판정.
 *
 * 왜 필요한가
 *   이 도구의 모든 것은 OS 예약 작업에서 돈다. **잠든 PC 는 아무것도 돌리지 않는다.**
 *   5분 감시가 그냥 멎고, 그 공백은 이 도구를 만들게 한 9시간 중단과 똑같이 보인다.
 *   실측(이 PC): 나흘 밤 각 84회(7시간 × 12) 기록, 공백 0 — 절전이 꺼져 있어서다.
 *   절전이 **켜진** PC 에서는 그 중 아무것도 일어나지 않는다.
 *
 * 🔴 판정은 순수 함수다. 값을 읽고 쓰는 것은 scripts/pc-settings.ps1 이다.
 *   스케줄러와 같은 분리다 — .ps1 은 출처, .mjs 는 판정. 그래야 시험할 수 있다.
 *   읽기(IO)는 아래에 캐시와 함께 둔다(lib/scheduler.mjs 와 같은 모양).
 *
 * 🔴 배터리(DC)는 건드리지 않는다.
 *   배터리에서 절전을 끄면 배터리를 태운다. 그건 사용자의 PC 이지 우리 것이 아니다.
 *   전원이 연결된 상태(AC)만 권장하고, 배터리는 **보여주기만** 한다.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME } from './config.mjs'

/** 못 읽은 값. 0 과 구별해야 한다 — 0 은 "안 함"이고 null 은 "모른다"다 */
export const 모름 = null

/**
 * 사실상 "안 함"인가.
 * Windows 는 보통 0 을 쓰지만, 2147483647 같은 큰 값을 쓰는 OEM 도 있다(실측).
 * 하루를 넘기는 대기는 우리 목적에서는 안 자는 것과 같다.
 */
export const 사실상안함 = (초) => 초 === 0 || (Number.isFinite(초) && 초 >= 86400)

/** 초 → 사람이 읽는 말 */
export function 시간말(초) {
  if (초 === null || 초 === undefined) return '모름'
  if (사실상안함(초)) return '안 함'
  const 분 = Math.round(초 / 60)
  return 분 >= 60 ? `${Math.round(분 / 6) / 10}시간 뒤` : `${분}분 뒤`
}

const 덮개말 = { 0: '아무 것도 안 함', 1: '절전', 2: '최대 절전', 3: '시스템 종료' }

/**
 * 설정 하나에 대한 판정.
 * @returns {{키,이름,현재,권장,수준,왜,고칠수있나}} 수준: ok | warn | crit | unknown
 */
function 항목(키, 이름, 현재말, 권장말, 수준, 왜, 고칠수있나 = false) {
  return { 키, 이름, 현재: 현재말, 권장: 권장말, 수준, 왜, 고칠수있나 }
}

/**
 * PC 설정 전체 판정. 순수 함수.
 * @param s scripts/pc-settings.ps1 -Json 의 결과
 */
export function pc판정(s) {
  const 목록 = []
  if (!s || s.ok !== true) {
    return {
      읽음: false,
      목록: [항목('읽기', 'PC 설정', '읽을 수 없다', '—', 'unknown',
        `설정을 읽지 못했다 — ${s?.오류 || '이유 불명'}. 판정할 수 없으므로 괜찮다고 말하지 않는다`)],
      수준: 'unknown', 고칠것: [],
    }
  }

  /* ── 전원 연결(AC) — 여기가 본론이다 ── */
  목록.push(
    사실상안함(s.standbyAc)
      ? 항목('standbyAc', '절전 (전원 연결)', 시간말(s.standbyAc), '안 함', 'ok', '잠들지 않으므로 감시가 계속 돈다')
      : s.standbyAc === 모름
        ? 항목('standbyAc', '절전 (전원 연결)', '모름', '안 함', 'unknown', '값을 읽지 못했다 — 직접 확인해야 한다')
        : 항목('standbyAc', '절전 (전원 연결)', 시간말(s.standbyAc), '안 함', 'crit',
          `${시간말(s.standbyAc)} 잠든다. 잠든 PC 는 예약 작업을 돌리지 않는다 — 감시도 재개도 그때 멎는다`, true))

  // 최대 절전이 아예 꺼져 있으면 이 값은 발동할 수 없다 — 경고할 일이 아니다
  if (s.hibernateAvailable) {
    목록.push(
      사실상안함(s.hibernateAc)
        ? 항목('hibernateAc', '최대 절전 (전원 연결)', 시간말(s.hibernateAc), '안 함', 'ok', '')
        : s.hibernateAc === 모름
          ? 항목('hibernateAc', '최대 절전 (전원 연결)', '모름', '안 함', 'unknown', '값을 읽지 못했다')
          : 항목('hibernateAc', '최대 절전 (전원 연결)', 시간말(s.hibernateAc), '안 함', 'crit',
            `${시간말(s.hibernateAc)} 최대 절전에 든다. 절전과 같은 결과다`, true))
  } else {
    목록.push(항목('hibernateAc', '최대 절전', '이 PC 에서 꺼져 있음', '—', 'ok',
      '최대 절전이 사용 불가라 발동할 수 없다'))
  }

  /* ── 덮개 (노트북만) ── */
  if (s.hasBattery) {
    if (s.lidAc === 모름) {
      목록.push(항목('lidAc', '덮개 닫기 (전원 연결)', '모름', '아무 것도 안 함', 'unknown',
        '이 PC 의 전원 구성에 덮개 항목이 없다(숨김). 제어판에서 직접 확인해야 한다'))
    } else if (s.lidAc === 0) {
      목록.push(항목('lidAc', '덮개 닫기 (전원 연결)', 덮개말[0], '아무 것도 안 함', 'ok', ''))
    } else {
      목록.push(항목('lidAc', '덮개 닫기 (전원 연결)', 덮개말[s.lidAc] ?? `코드 ${s.lidAc}`, '아무 것도 안 함', 'warn',
        '덮개를 닫으면 잠들어 감시가 멎는다. 덮고 자리를 비우는 일이 없다면 그대로 둬도 된다', true))
    }
  }

  /* ── 배터리(DC) — 보여주기만 한다 ── */
  목록.push(항목('standbyDc', '절전 (배터리)', 시간말(s.standbyDc), '건드리지 않음', 'info',
    사실상안함(s.standbyDc)
      ? '배터리에서도 잠들지 않는다'
      : `배터리에서는 ${시간말(s.standbyDc)} 잠든다. 그때는 감시가 멎는다 — 배터리를 태우지 않으려면 이게 맞다`))

  /* ── 로그온 상태 ── */
  목록.push(항목('logon', '로그온 유지', s.lockedNow ? '잠금 (로그온 상태)' : '로그온 상태', '로그오프하지 않기', 'ok',
    '화면 잠금(Win+L)은 로그오프가 아니라서 계속 돈다. 로그오프하거나 사용자를 전환하면 멎는다'))

  const 수준 = 목록.some((x) => x.수준 === 'crit') ? 'crit'
    : 목록.some((x) => x.수준 === 'unknown') ? 'unknown'
      : 목록.some((x) => x.수준 === 'warn') ? 'warn' : 'ok'

  return { 읽음: true, 목록, 수준, 고칠것: 목록.filter((x) => x.고칠수있나).map((x) => x.키) }
}

/**
 * 고칠 항목 → `pc-settings.ps1` 에 넘길 인자.
 *
 * 🔴 AC 만 바꾼다. 배터리(DC)는 절대 여기서 바꾸지 않는다 — 위 머리말 참조.
 */
export function 적용인자(고칠것) {
  const args = []
  if (고칠것.includes('standbyAc')) args.push('-StandbyAc', '0')
  if (고칠것.includes('hibernateAc')) args.push('-HibernateAc', '0')
  if (고칠것.includes('lidAc')) args.push('-LidAc', '0')
  return args
}

/** 되돌리기용 인자 — 백업해 둔 값으로 되돌린다 */
export function 복원인자(백업) {
  const args = []
  const 넣기 = (키, 값) => { if (Number.isFinite(값)) args.push(키, String(값)) }
  넣기('-StandbyAc', 백업?.standbyAc)
  넣기('-HibernateAc', 백업?.hibernateAc)
  넣기('-LidAc', 백업?.lidAc)
  return args
}

/* ── 읽기·쓰기 (IO) ──────────────────────────────────────────── */

const 스크립트 = () => join(RS_HOME, 'scripts', 'pc-settings.ps1')

/**
 * pc-settings.ps1 을 부른다.
 * 🔴 창을 띄우지 않고(windowsHide) 셸을 거치지 않는다 — 저장소 규칙.
 * 🔴 못 읽었으면 `ok:false` 다. 괜찮다고 하지 않는다(판정이 unknown 으로 받는다).
 */
export function 읽기(추가인자 = []) {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 스크립트(), '-Json', ...추가인자,
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(out.trim().split('\n').pop())
  } catch (e) {
    return { ok: false, 오류: (e.stderr || e.message || String(e)).toString().slice(0, 300) }
  }
}

/**
 * 화면용 — 캐시해서 돌려준다.
 *
 * 🔴 왜 캐시인가 (실측)
 *   powercfg 를 세 번 부르는 데 **474~483ms** 걸린다. 화면은 3초마다, 트레이는
 *   2.5초마다 상태를 묻는다. 캐시 없이 끼워 넣으면 모든 조회가 0.5초씩 느려진다.
 *   전원 설정은 사람이 바꾸기 전에는 그대로이므로 1분은 낡아도 무해하다.
 */
const _캐시 = { at: 0, v: null }
export function pc상태({ ttlMs = 60000, 강제 = false } = {}) {
  // 🔴 백업과 안내는 **두 갈래 모두**에 담는다.
  //   캐시 경로에서 빠뜨려 화면의 "수동 설정 방법" 단추가 빈 채로 떴다(실측).
  //   안내는 고정 문구라 캐시할 것도 없고, 백업은 방금 적용했는지를 바로 알아야 한다.
  const 덧붙일것 = () => ({ 백업: 백업정보(), 안내: 수동안내() })

  if (!강제 && _캐시.v && Date.now() - _캐시.at < ttlMs) {
    return { ..._캐시.v, ...덧붙일것(), 캐시됨: true, 나이초: Math.round((Date.now() - _캐시.at) / 1000) }
  }
  const v = pc판정(읽기())
  _캐시.at = Date.now()
  _캐시.v = v
  return { ...v, ...덧붙일것(), 캐시됨: false, 나이초: 0 }
}

/**
 * 보관해 둔 이전 값.
 *
 * 🔴 되돌릴 수 있다는 것을 **화면이 보여줘야** 한다. 되돌릴 길을 모르면 사람은
 *   버튼을 누르지 못한다 — 그러면 고칠 수 있는 문제가 그대로 남는다.
 */
export function 백업정보() {
  const p = join(RS_HOME, 'state', 'pc-backup.json')
  if (!existsSync(p)) return { 있음: false }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return { 있음: true, at: j.at || null, 바꾼것: j.바꾼것 || [], 이전: j.이전 || {} }
  } catch (e) {
    // 깨진 백업을 "있음"이라 하면 되돌리기 단추가 헛돈다
    return { 있음: false, 오류: `보관된 값이 깨졌다: ${e.message}` }
  }
}

/** 설정을 바꾼 뒤에는 캐시가 거짓말을 한다 — 버린다 */
export const 캐시비우기 = () => { _캐시.at = 0; _캐시.v = null }

/** 자동으로 못 고치는 것들의 수동 안내 */
export const 수동안내 = () => ([
  '제어판에서 직접 바꾸는 법',
  '',
  '  절전 / 최대 절전',
  '    설정 > 시스템 > 전원 및 배터리 > 화면, 절전 모드 및 최대 절전 모드 시간 제한',
  '    "전원 사용 시 다음 시간 후 장치를 절전 모드로 전환" = 안 함',
  '',
  '  덮개 닫기 (노트북)',
  '    제어판 > 하드웨어 및 소리 > 전원 옵션 > 덮개를 닫으면 수행되는 작업 선택',
  '    "전원 사용 시" = 아무 것도 안 함',
  '',
  '  로그오프하지 않기',
  '    화면 잠금(Win+L)은 괜찮다 — 로그온 상태가 유지되므로 계속 돈다.',
  '    로그오프·사용자 전환·시스템 종료는 멈춘다(다시 로그온하면 자동으로 살아난다).',
])
