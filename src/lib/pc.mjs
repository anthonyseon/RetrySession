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
export const unknown = null

/**
 * 사실상 "안 함"인가.
 * Windows 는 보통 0 을 쓰지만, 2147483647 같은 큰 값을 쓰는 OEM 도 있다(실측).
 * 하루를 넘기는 대기는 우리 목적에서는 안 자는 것과 같다.
 */
export const effectivelyNever = (seconds) => seconds === 0 || (Number.isFinite(seconds) && seconds >= 86400)

/** 초 → 사람이 읽는 말 */
export function timeText(seconds) {
  if (seconds === null || seconds === undefined) return '모름'
  if (effectivelyNever(seconds)) return '안 함'
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 ? `${Math.round(minutes / 6) / 10}시간 뒤` : `${minutes}분 뒤`
}

const lidText = { 0: '아무 것도 안 함', 1: '절전', 2: '최대 절전', 3: '시스템 종료' }

/**
 * 설정 하나에 대한 판정.
 * @returns {{키,이름,현재,권장,수준,왜,고칠수있나}} 수준: ok | warn | crit | unknown
 */
function item(key, name, nowText, wantText, level, why, canFix = false, raw = null) {
  // 원값 — 화면의 고르는 칸이 "지금 무엇이 골라져 있나"를 표시하려면 숫자가 필요하다.
  // 현재말('10분 뒤')은 사람용이고, 원값(600)은 기계용이다. 둘을 섞으면 안 된다.
  return { key, name, current: nowText, recommended: wantText, level, why, canFix, raw }
}

/**
 * PC 설정 전체 판정. 순수 함수.
 * @param s scripts/pc-settings.ps1 -Json 의 결과
 */
export function pcVerdict(s) {
  const items = []
  if (!s || s.ok !== true) {
    return {
      read: false,
      items: [item('읽기', 'PC 설정', '읽을 수 없다', '—', 'unknown',
        `설정을 읽지 못했다 — ${s?.error || '이유 불명'}. 판정할 수 없으므로 괜찮다고 말하지 않는다`)],
      level: 'unknown', fixable: [],
    }
  }

  /* ── 전원 연결(AC) — 여기가 본론이다 ── */
  items.push(
    effectivelyNever(s.standbyAc)
      ? item('standbyAc', '절전 (전원 연결)', timeText(s.standbyAc), '안 함', 'ok',
        '잠들지 않으므로 감시가 계속 돈다', false, s.standbyAc)
      : s.standbyAc === unknown
        ? item('standbyAc', '절전 (전원 연결)', '모름', '안 함', 'unknown', '값을 읽지 못했다 — 직접 확인해야 한다')
        : item('standbyAc', '절전 (전원 연결)', timeText(s.standbyAc), '안 함', 'crit',
          `${timeText(s.standbyAc)} 잠든다. 잠든 PC 는 예약 작업을 돌리지 않는다 — 감시도 재개도 그때 멎는다`,
          true, s.standbyAc))

  // 최대 절전이 아예 꺼져 있으면 이 값은 발동할 수 없다 — 경고할 일이 아니다
  if (s.hibernateAvailable) {
    items.push(
      effectivelyNever(s.hibernateAc)
        ? item('hibernateAc', '최대 절전 (전원 연결)', timeText(s.hibernateAc), '안 함', 'ok', '',
          false, s.hibernateAc)
        : s.hibernateAc === unknown
          ? item('hibernateAc', '최대 절전 (전원 연결)', '모름', '안 함', 'unknown', '값을 읽지 못했다')
          : item('hibernateAc', '최대 절전 (전원 연결)', timeText(s.hibernateAc), '안 함', 'crit',
            `${timeText(s.hibernateAc)} 최대 절전에 든다. 절전과 같은 결과다`, true, s.hibernateAc))
  } else {
    // 원값 없이 둔다 → 화면이 고르는 칸을 주지 않는다. 사용 불가인 설정을 고르게 하면
    // 골라도 아무 일이 안 일어나고, 사람은 자기가 바꿨다고 믿는다. 그게 최악이다.
    items.push(item('hibernateAc', '최대 절전', '이 PC 에서 꺼져 있음', '—', 'ok',
      '최대 절전이 사용 불가라 발동할 수 없다'))
  }

  /* ── 덮개 (노트북만) ── */
  if (s.hasBattery) {
    if (s.lidAc === unknown) {
      /**
       * 🔴 여기에는 고르는 칸을 주지 않는다(원값 없음).
       *   실측: 이 PC 는 전원 구성에 덮개 항목이 없는데도 `powercfg /setacvalueindex
       *   ... LIDACTION 0` 이 **성공을 돌려준다**. 다시 읽으면 여전히 null 이다.
       *   고를 수 있게 해 두면 사람은 고르고, 적용됐다고 믿고, 실제로는 안 바뀐다.
       */
      items.push(item('lidAc', '덮개 닫기 (전원 연결)', '모름', '아무 것도 안 함', 'unknown',
        '이 PC 의 전원 구성에 덮개 항목이 없다(숨김). 제어판에서 직접 확인해야 한다'))
    } else if (s.lidAc === 0) {
      items.push(item('lidAc', '덮개 닫기 (전원 연결)', lidText[0], '아무 것도 안 함', 'ok', '',
        false, s.lidAc))
    } else {
      items.push(item('lidAc', '덮개 닫기 (전원 연결)', lidText[s.lidAc] ?? `코드 ${s.lidAc}`, '아무 것도 안 함', 'warn',
        '덮개를 닫으면 잠들어 감시가 멎는다. 덮고 자리를 비우는 일이 없다면 그대로 둬도 된다',
        true, s.lidAc))
    }
  }

  /* ── 배터리(DC) — 보여주기만 한다 ── */
  /**
   * 고칠수있나 = false (자동 적용은 배터리를 절대 건드리지 않는다)이지만
   * 원값은 준다 — **사람이 직접 고르는 것은 막지 않는다.**
   * 우리가 알아서 배터리 절전을 끄는 것은 월권, 사람이 알고 고르는 것은 선택이다.
   */
  items.push(item('standbyDc', '절전 (배터리)', timeText(s.standbyDc), '건드리지 않음', 'info',
    effectivelyNever(s.standbyDc)
      ? '배터리에서도 잠들지 않는다'
      : `배터리에서는 ${timeText(s.standbyDc)} 잠든다. 그때는 감시가 멎는다 — 배터리를 태우지 않으려면 이게 맞다`,
    false, s.standbyDc))

  /* ── 로그온 상태 ── */
  items.push(item('logon', '로그온 유지', s.lockedNow ? '잠금 (로그온 상태)' : '로그온 상태', '로그오프하지 않기', 'ok',
    '화면 잠금(Win+L)은 로그오프가 아니라서 계속 돈다. 로그오프하거나 사용자를 전환하면 멎는다'))

  const level = items.some((x) => x.level === 'crit') ? 'crit'
    : items.some((x) => x.level === 'unknown') ? 'unknown'
      : items.some((x) => x.level === 'warn') ? 'warn' : 'ok'

  return { read: true, items, level, fixable: items.filter((x) => x.canFix).map((x) => x.key) }
}

/**
 * 고칠 항목 → `pc-settings.ps1` 에 넘길 인자.
 *
 * 🔴 AC 만 바꾼다. 배터리(DC)는 절대 여기서 바꾸지 않는다 — 위 머리말 참조.
 */
export function applyArgs(fixable) {
  const args = []
  if (fixable.includes('standbyAc')) args.push('-StandbyAc', '0')
  if (fixable.includes('hibernateAc')) args.push('-HibernateAc', '0')
  if (fixable.includes('lidAc')) args.push('-LidAc', '0')
  return args
}

/* ── 직접 수정 ────────────────────────────────────────────────── */

/**
 * 화면에서 고를 수 있는 값들. UI 와 검증이 **같은 목록**을 본다 —
 * 두 벌로 만들면 화면이 보내는 값을 서버가 거절하는 일이 생긴다.
 */
export const choices = {
  time: [
    { value: 0, label: '안 함' },
    { value: 300, label: '5분 뒤' }, { value: 600, label: '10분 뒤' }, { value: 900, label: '15분 뒤' },
    { value: 1800, label: '30분 뒤' }, { value: 3600, label: '1시간 뒤' },
    { value: 7200, label: '2시간 뒤' }, { value: 14400, label: '4시간 뒤' },
  ],
  lid: [
    { value: 0, label: '아무 것도 안 함' }, { value: 1, label: '절전' },
    { value: 2, label: '최대 절전' }, { value: 3, label: '시스템 종료' },
  ],
}

/**
 * 직접 수정으로 바꿀 수 있는 키와 그 종류.
 *
 * 🔴 배터리(Dc)도 여기에는 있다 — **사람이 직접 고를 때만.**
 *   자동 적용(적용인자)은 여전히 AC 만 건드린다. 우리가 알아서 배터리를 끄는 것과,
 *   사람이 알고 고르는 것은 다르다. 앞은 월권이고 뒤는 선택이다.
 */
export const editableKeys = {
  standbyAc: 'time', hibernateAc: 'time', lidAc: 'lid',
  standbyDc: 'time', hibernateDc: 'time', lidDc: 'lid',
}

/**
 * 화면이 보낸 값이 쓸 수 있는 값인가. 순수 함수.
 * 🔴 브라우저에서 온 값이다. 모르는 키·범위 밖·정수 아닌 것은 거절한다.
 */
export function validateValue(key, value) {
  const kind = editableKeys[key]
  if (!kind) return { ok: false, why: `바꿀 수 없는 항목이다: ${key}` }
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) return { ok: false, why: `${key} 는 0 이상의 정수여야 한다` }
  if (kind === 'lid') {
    return n <= 3 ? { ok: true, value: n } : { ok: false, why: '덮개 동작은 0~3 이다' }
  }
  // 30일을 넘는 대기는 사실상 "안 함"이고, 그건 0 으로 쓰는 것이 맞다
  if (n > 86400 * 30) return { ok: false, why: '너무 큰 값이다 — "안 함"은 0 으로 준다' }
  return { ok: true, value: n }
}

/** `{standbyAc:0, lidAc:1}` → `['-StandbyAc','0','-LidAc','1']` */
export function setArgs(values) {
  const args = []
  for (const [key, v] of Object.entries(values || {})) {
    const r = validateValue(key, v)
    if (!r.ok) continue
    args.push('-' + key[0].toUpperCase() + key.slice(1), String(r.value))
  }
  return args
}

/**
 * 요청한 값이 **정말 바뀌었는가.** 순수 함수.
 *
 * 🔴 실측 (2026-09-22): 이 PC 의 전원 구성에는 덮개 항목이 없다. 그런데
 *   `powercfg /setacvalueindex ... LIDACTION 0` 은 **성공한 척한다** —
 *   스크립트가 `wrote:true` 를 돌려주는데 다시 읽으면 여전히 null 이다.
 *   "바꿨다"고 말만 하고 안 바뀌는 것이 가장 나쁘다. 그래서 값마다 대조한다.
 */
export function verifyApplied(req, after) {
  const notApplied = []
  for (const [key, v] of Object.entries(req || {})) {
    const r = validateValue(key, v)
    if (!r.ok) continue
    const actual = after?.[key]
    // null 은 "읽을 수 없다" — 바뀌었는지 확인할 방법이 없으므로 안 된 것으로 본다
    if (actual === null || actual === undefined || Number(actual) !== r.value) {
      notApplied.push({ key, req: r.value, actual: actual ?? null })
    }
  }
  return { ok: notApplied.length === 0, notApplied }
}

/** 되돌리기용 인자 — 백업해 둔 값으로 되돌린다 */
export function restoreArgs(backup) {
  const args = []
  const put = (key, value) => { if (Number.isFinite(value)) args.push(key, String(value)) }
  put('-StandbyAc', backup?.standbyAc)
  put('-HibernateAc', backup?.hibernateAc)
  put('-LidAc', backup?.lidAc)
  return args
}

/* ── 읽기·쓰기 (IO) ──────────────────────────────────────────── */

const scriptPath = () => join(RS_HOME, 'scripts', 'pc-settings.ps1')

/**
 * pc-settings.ps1 을 부른다.
 * 🔴 창을 띄우지 않고(windowsHide) 셸을 거치지 않는다 — 저장소 규칙.
 * 🔴 못 읽었으면 `ok:false` 다. 괜찮다고 하지 않는다(판정이 unknown 으로 받는다).
 */
export function readPs(extraArgs = []) {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath(), '-Json', ...extraArgs,
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(out.trim().split('\n').pop())
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || String(e)).toString().slice(0, 300) }
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
const _cache2 = { at: 0, v: null }
export function pcState({ ttlMs = 60000, force = false } = {}) {
  // 🔴 백업과 안내는 **두 갈래 모두**에 담는다.
  //   캐시 경로에서 빠뜨려 화면의 "수동 설정 방법" 단추가 빈 채로 떴다(실측).
  //   안내는 고정 문구라 캐시할 것도 없고, 백업은 방금 적용했는지를 바로 알아야 한다.
  // 선택지도 함께 보낸다 — 화면과 서버가 **같은 목록**을 봐야 화면이 보낸 값을
  // 서버가 거절하는 일이 없다.
  const extraInfo = () => ({ backup: backupInfo(), guide: manualGuide(), choices, editableKeys })

  if (!force && _cache2.v && Date.now() - _cache2.at < ttlMs) {
    return { ..._cache2.v, ...extraInfo(), cached: true, ageSec: Math.round((Date.now() - _cache2.at) / 1000) }
  }
  const v = pcVerdict(readPs())
  _cache2.at = Date.now()
  _cache2.v = v
  return { ...v, ...extraInfo(), cached: false, ageSec: 0 }
}

/**
 * 보관해 둔 이전 값.
 *
 * 🔴 되돌릴 수 있다는 것을 **화면이 보여줘야** 한다. 되돌릴 길을 모르면 사람은
 *   버튼을 누르지 못한다 — 그러면 고칠 수 있는 문제가 그대로 남는다.
 */
export function backupInfo() {
  const p = join(RS_HOME, 'state', 'pc-backup.json')
  if (!existsSync(p)) return { exists: false }
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'))
    return { exists: true, at: j.at || null, changedKeys: j.changedKeys || [], prev: j.prev || {} }
  } catch (e) {
    // 깨진 백업을 "있음"이라 하면 되돌리기 단추가 헛돈다
    return { exists: false, error: `보관된 값이 깨졌다: ${e.message}` }
  }
}

/** 설정을 바꾼 뒤에는 캐시가 거짓말을 한다 — 버린다 */
export const clearCache = () => { _cache2.at = 0; _cache2.v = null }

/** 자동으로 못 고치는 것들의 수동 안내 */
export const manualGuide = () => ([
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
