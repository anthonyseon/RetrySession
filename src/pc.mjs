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
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME } from './lib/config.mjs'
import { writeJsonAtomic } from './lib/io.mjs'
import {
  pcVerdict, applyArgs, restoreArgs, manualGuide, readPs, validateValue, setArgs, verifyApplied,
} from './lib/pc.mjs'
import { localStamp } from './lib/stamp.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const backupPath = join(RS_HOME, 'state', 'pc-backup.json')


const icon = { ok: '✅', warn: '⚠', crit: '✖', unknown: '?', info: 'ℹ' }

function render(verdict) {
  console.log('== PC 설정 — RetrySession 이 돌기 위한 조건 ==')
  for (const x of verdict.items) {
    console.log(`  ${icon[x.level] || ' '} ${x.name.padEnd(22)} ${String(x.current).padEnd(16)} (권장: ${x.recommended})`)
    if (x.why) console.log(`      ${x.why}`)
  }
  console.log('')
  if (verdict.level === 'ok') console.log('  ✅ 이 PC 는 RetrySession 이 계속 돌 수 있는 상태다.')
  else if (verdict.level === 'crit') console.log('  ✖ 이대로는 PC 가 잠들면 감시도 재개도 멎는다.')
  else if (verdict.level === 'warn') console.log('  ⚠ 대체로 괜찮지만 위 항목을 보라.')
  else console.log('  ? 일부 값을 읽지 못했다 — 괜찮다고 말할 수 없다.')

  if (verdict.fixable.length) {
    console.log(`  고칠 수 있는 것 ${verdict.fixable.length}개: node src/pc.mjs --apply  (되돌리기: --restore)`)
  }
  // 'info' 는 알려주기만 하는 줄이다 — 할 일 목록에 넣으면 할 일이 아닌 것이 쌓인다
  const manual = verdict.items.filter((x) => x.level === 'unknown' || (x.level === 'warn' && !x.canFix))
  if (manual.length) console.log(`  손으로 확인할 것 ${manual.length}개: node src/pc.mjs --manual`)
}

/* ── 부속 명령 ───────────────────────────────────────────────── */

if (flag('--manual')) {
  for (const l of manualGuide()) console.log(l)
  process.exit(0)
}

if (flag('--json')) {
  const s = readPs()
  console.log(JSON.stringify({ raw: s, ...pcVerdict(s), at: localStamp() }, null, 2))
  process.exit(0)
}

if (flag('--restore')) {
  if (!existsSync(backupPath)) {
    console.error('✖ 되돌릴 기록이 없다 — --apply 를 한 적이 없다.')
    process.exit(1)
  }
  let backup
  try { backup = JSON.parse(readFileSync(backupPath, 'utf8')) } catch (e) {
    console.error(`✖ 백업을 읽을 수 없다: ${e.message}`)
    process.exit(1)
  }
  const args2 = restoreArgs(backup.prev)
  if (!args2.length) {
    console.error('✖ 백업에 되돌릴 값이 없다.')
    process.exit(1)
  }
  console.log(`되돌린다 — ${backup.at} 시점의 값으로`)
  const after = readPs(args2)
  render(pcVerdict(after))
  process.exit(0)
}

/* ── 점검 (기본) · 적용 ──────────────────────────────────────── */

const before = readPs()
const verdict = pcVerdict(before)

/**
 * `--set standbyAc=600 lidAc=0` — **사람이 고른 값을 그대로** 쓴다.
 *
 * 🔴 권장값 적용(--apply)과 다른 점: 여기서는 배터리(Dc)도 바꿀 수 있다.
 *   우리가 알아서 배터리를 끄는 것은 월권이지만, 사람이 알고 고르는 것은 선택이다.
 *
 * 🔴 안전장치는 --apply 와 **똑같이** 거친다: 백업 먼저 · 바꾼 뒤 다시 읽어 확인.
 *   게다가 값마다 대조한다 — 이 PC 의 덮개 항목처럼 powercfg 가 **성공한 척하고
 *   아무것도 바꾸지 않는** 경우가 실제로 있다(실측).
 */
if (flag('--set')) {
  const values = {}
  const wrong = []
  for (const a of argv) {
    const m = /^([A-Za-z]+)=(-?\d+)$/.exec(a)
    if (!m) continue
    const r = validateValue(m[1], m[2])
    if (r.ok) values[m[1]] = r.value
    else wrong.push(`${a} — ${r.why}`)
  }
  for (const w of wrong) console.error(`⚠ 무시함: ${w}`)
  if (!Object.keys(values).length) {
    console.error('✖ 바꿀 값이 없다. 예: node src/pc.mjs --set standbyAc=0 lidAc=0')
    process.exit(1)
  }
  if (!verdict.read) {
    console.error('✖ 설정을 읽지 못해 바꿀 수 없다. 무엇을 되돌려야 할지 모르는 채로 바꾸지 않는다.')
    process.exit(1)
  }

  try {
    writeJsonAtomic(backupPath, {
      _note: '설정을 바꾸기 직전의 PC 전원 설정. node src/pc.mjs --restore 로 되돌린다.',
      at: localStamp(), changedKeys: Object.keys(values),
      prev: {
        standbyAc: before.standbyAc, hibernateAc: before.hibernateAc, lidAc: before.lidAc,
        standbyDc: before.standbyDc, hibernateDc: before.hibernateDc, lidDc: before.lidDc,
      },
    })
  } catch (e) {
    console.error(`✖ 되돌리기 기록을 저장하지 못했다: ${e.message}`)
    console.error('  되돌릴 수 없는 변경은 하지 않는다. 바꾸지 않고 끝낸다.')
    process.exit(1)
  }

  console.log(`바꾼다: ${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  const after2 = readPs(setArgs(values))
  render(pcVerdict(after2))

  const confirmed = verifyApplied(values, after2)
  if (!confirmed.ok) {
    console.error('')
    for (const x of confirmed.notApplied) {
      console.error(`✖ ${x.key}: ${x.req} 로 바꾸려 했는데 실제는 ${x.actual === null ? '읽을 수 없음' : x.actual} 이다`)
    }
    console.error('  이 항목은 이 PC 의 전원 구성에 없을 수 있다(숨김). --manual 의 방법으로 직접 바꿔라.')
    process.exit(1)
  }
  console.log('✅ 적용됐다. 되돌리려면: node src/pc.mjs --restore')
  process.exit(0)
}

if (!flag('--apply')) {
  render(verdict)
  /**
   * 🔴 exit 1 은 **확실히 멎는 경우에만** 쓴다.
   *
   *   읽지 못한 값(이 PC 의 덮개 설정처럼 전원 구성에 항목이 아예 없는 경우)까지
   *   실패로 매기면 **영원히 exit 1** 이다. 고칠 방법도 없는데 매번 빨갛게 뜨면
   *   사람은 곧 무시하고, 그러면 진짜 crit 도 같이 묻힌다.
   *   이 저장소가 반복해서 고친 그 실패다 — 끝없는 경보는 경보가 아니다.
   *   모름·경고는 화면에 또렷이 적되 종료 코드는 0 으로 둔다.
   */
  process.exit(verdict.level === 'crit' ? 1 : 0)
}

/* --apply */
if (!verdict.read) {
  console.error('✖ 설정을 읽지 못해 바꿀 수 없다. 무엇을 되돌려야 할지 모르는 채로 바꾸지 않는다.')
  process.exit(1)
}
if (!verdict.fixable.length) {
  console.log('바꿀 것이 없다.')
  render(verdict)
  process.exit(0)
}

/**
 * 🔴 바꾸기 전에 되돌릴 길을 먼저 만든다.
 *   남의 PC 설정을 바꾸는 일이다. 저장에 실패하면 바꾸지 않는다 —
 *   되돌릴 수 없는 변경은 하지 않는다.
 */
try {
  writeJsonAtomic(backupPath, {
    _note: '--apply 직전의 PC 전원 설정. node src/pc.mjs --restore 로 되돌린다.',
    at: localStamp(), changedKeys: verdict.fixable,
    prev: { standbyAc: before.standbyAc, hibernateAc: before.hibernateAc, lidAc: before.lidAc },
  })
} catch (e) {
  console.error(`✖ 되돌리기 기록을 저장하지 못했다: ${e.message}`)
  console.error('  되돌릴 수 없는 변경은 하지 않는다. 바꾸지 않고 끝낸다.')
  process.exit(1)
}

console.log(`바꾼다: ${verdict.fixable.join(', ')}  (이전 값은 state/pc-backup.json 에 저장했다)`)
const after = readPs(applyArgs(verdict.fixable))
const afterVerdict = pcVerdict(after)
render(afterVerdict)

// 바꿨다고 말만 하고 안 바뀌었으면 그게 최악이다 — 다시 읽어 확인한다
const left = afterVerdict.items.filter((x) => x.level === 'crit')
if (left.length) {
  console.error(`✖ 바꿨는데도 남아 있다: ${left.map((x) => x.name).join(', ')}`)
  process.exit(1)
}
console.log('✅ 적용됐다. 되돌리려면: node src/pc.mjs --restore')
process.exit(0)
