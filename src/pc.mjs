/**
 * pc.mjs — PC 설정을 점검하고, 원하면 고치고, 되돌린다.
 *
 * 사용법
 *   node src/pc.mjs            점검만 한다 (아무것도 바꾸지 않는다. 문제 있으면 exit 1)
 *   node src/pc.mjs --apply    권장값으로 바꾼다 (바꾸기 전 값을 저장한다)
 *   node src/pc.mjs --restore  --apply 이전 값으로 되돌린다
 *   node src/pc.mjs --manual   손으로 바꾸는 방법을 적어준다
 *   node src/pc.mjs --json     기계가 읽을 형태로 (화면이 쓴다)
 *
 * 🔴 기본은 **점검**이다. 남의 PC 설정을 묻지도 않고 바꾸지 않는다.
 *   바꾸려면 --apply 를 직접 쳐야 하고, 바꾸기 전 값을 state/pc-backup.json 에
 *   원자적으로 저장해 --restore 로 언제든 되돌릴 수 있게 한다.
 *   되돌릴 수 없는 변경은 하지 않는다.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME } from './lib/config.mjs'
import { 원자JSON쓰기 } from './lib/io.mjs'
import { pc판정, 적용인자, 복원인자, 수동안내 } from './lib/pc.mjs'
import { localStamp } from './lib/stamp.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const 백업경로 = join(RS_HOME, 'state', 'pc-backup.json')
const 스크립트 = join(RS_HOME, 'scripts', 'pc-settings.ps1')

/**
 * pc-settings.ps1 을 부른다.
 * 🔴 창이 뜨지 않게 windowsHide 로 띄우고 셸을 거치지 않는다(저장소 규칙).
 */
export function 읽기(추가인자 = []) {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 스크립트, '-Json', ...추가인자,
    ], { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    return JSON.parse(out.trim().split('\n').pop())
  } catch (e) {
    // 🔴 못 읽었으면 괜찮다고 하지 않는다 — 판정이 unknown 으로 받는다
    return { ok: false, 오류: (e.stderr || e.message || String(e)).toString().slice(0, 300) }
  }
}

const 아이콘 = { ok: '✅', warn: '⚠', crit: '✖', unknown: '?', info: 'ℹ' }

function 보이기(판정) {
  console.log('== PC 설정 — RetrySession 이 돌기 위한 조건 ==')
  for (const x of 판정.목록) {
    console.log(`  ${아이콘[x.수준] || ' '} ${x.이름.padEnd(22)} ${String(x.현재).padEnd(16)} (권장: ${x.권장})`)
    if (x.왜) console.log(`      ${x.왜}`)
  }
  console.log('')
  if (판정.수준 === 'ok') console.log('  ✅ 이 PC 는 RetrySession 이 계속 돌 수 있는 상태다.')
  else if (판정.수준 === 'crit') console.log('  ✖ 이대로는 PC 가 잠들면 감시도 재개도 멎는다.')
  else if (판정.수준 === 'warn') console.log('  ⚠ 대체로 괜찮지만 위 항목을 보라.')
  else console.log('  ? 일부 값을 읽지 못했다 — 괜찮다고 말할 수 없다.')

  if (판정.고칠것.length) {
    console.log(`  고칠 수 있는 것 ${판정.고칠것.length}개: node src/pc.mjs --apply  (되돌리기: --restore)`)
  }
  // 'info' 는 알려주기만 하는 줄이다 — 할 일 목록에 넣으면 할 일이 아닌 것이 쌓인다
  const 수동 = 판정.목록.filter((x) => x.수준 === 'unknown' || (x.수준 === 'warn' && !x.고칠수있나))
  if (수동.length) console.log(`  손으로 확인할 것 ${수동.length}개: node src/pc.mjs --manual`)
}

/* ── 부속 명령 ───────────────────────────────────────────────── */

if (flag('--manual')) {
  for (const l of 수동안내()) console.log(l)
  process.exit(0)
}

if (flag('--json')) {
  const s = 읽기()
  console.log(JSON.stringify({ 원본: s, ...pc판정(s), at: localStamp() }, null, 2))
  process.exit(0)
}

if (flag('--restore')) {
  if (!existsSync(백업경로)) {
    console.error('✖ 되돌릴 기록이 없다 — --apply 를 한 적이 없다.')
    process.exit(1)
  }
  let 백업
  try { 백업 = JSON.parse(readFileSync(백업경로, 'utf8')) } catch (e) {
    console.error(`✖ 백업을 읽을 수 없다: ${e.message}`)
    process.exit(1)
  }
  const 인자 = 복원인자(백업.이전)
  if (!인자.length) {
    console.error('✖ 백업에 되돌릴 값이 없다.')
    process.exit(1)
  }
  console.log(`되돌린다 — ${백업.at} 시점의 값으로`)
  const 뒤 = 읽기(인자)
  보이기(pc판정(뒤))
  process.exit(0)
}

/* ── 점검 (기본) · 적용 ──────────────────────────────────────── */

const 앞 = 읽기()
const 판정 = pc판정(앞)

if (!flag('--apply')) {
  보이기(판정)
  /**
   * 🔴 exit 1 은 **확실히 멎는 경우에만** 쓴다.
   *
   *   읽지 못한 값(이 PC 의 덮개 설정처럼 전원 구성에 항목이 아예 없는 경우)까지
   *   실패로 매기면 **영원히 exit 1** 이다. 고칠 방법도 없는데 매번 빨갛게 뜨면
   *   사람은 곧 무시하고, 그러면 진짜 crit 도 같이 묻힌다.
   *   이 저장소가 반복해서 고친 그 실패다 — 끝없는 경보는 경보가 아니다.
   *   모름·경고는 화면에 또렷이 적되 종료 코드는 0 으로 둔다.
   */
  process.exit(판정.수준 === 'crit' ? 1 : 0)
}

/* --apply */
if (!판정.읽음) {
  console.error('✖ 설정을 읽지 못해 바꿀 수 없다. 무엇을 되돌려야 할지 모르는 채로 바꾸지 않는다.')
  process.exit(1)
}
if (!판정.고칠것.length) {
  console.log('바꿀 것이 없다.')
  보이기(판정)
  process.exit(0)
}

/**
 * 🔴 바꾸기 전에 되돌릴 길을 먼저 만든다.
 *   남의 PC 설정을 바꾸는 일이다. 저장에 실패하면 바꾸지 않는다 —
 *   되돌릴 수 없는 변경은 하지 않는다.
 */
try {
  원자JSON쓰기(백업경로, {
    _주의: '--apply 직전의 PC 전원 설정. node src/pc.mjs --restore 로 되돌린다.',
    at: localStamp(), 바꾼것: 판정.고칠것,
    이전: { standbyAc: 앞.standbyAc, hibernateAc: 앞.hibernateAc, lidAc: 앞.lidAc },
  })
} catch (e) {
  console.error(`✖ 되돌리기 기록을 저장하지 못했다: ${e.message}`)
  console.error('  되돌릴 수 없는 변경은 하지 않는다. 바꾸지 않고 끝낸다.')
  process.exit(1)
}

console.log(`바꾼다: ${판정.고칠것.join(', ')}  (이전 값은 state/pc-backup.json 에 저장했다)`)
const 뒤 = 읽기(적용인자(판정.고칠것))
const 뒤판정 = pc판정(뒤)
보이기(뒤판정)

// 바꿨다고 말만 하고 안 바뀌었으면 그게 최악이다 — 다시 읽어 확인한다
const 남은 = 뒤판정.목록.filter((x) => x.수준 === 'crit')
if (남은.length) {
  console.error(`✖ 바꿨는데도 남아 있다: ${남은.map((x) => x.이름).join(', ')}`)
  process.exit(1)
}
console.log('✅ 적용됐다. 되돌리려면: node src/pc.mjs --restore')
process.exit(0)
