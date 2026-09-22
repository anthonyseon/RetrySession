/**
 * pc.test.mjs — PC 설정 판정.
 *
 * 🔴 왜 중요한가
 *   이 도구의 모든 것은 OS 예약 작업에서 돈다. **잠든 PC 는 아무것도 돌리지 않는다.**
 *   5분 감시가 그냥 멎고, 그 공백은 이 도구를 만들게 한 9시간 중단과 똑같이 보인다.
 *   실측(이 PC): 나흘 밤 각 84회(7시간 × 12) 기록, 공백 0 — 절전이 꺼져 있어서다.
 *
 * 🔴 이 기능은 **남의 PC 설정을 바꾼다.** 규칙 하나하나에 시험을 붙인다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pcVerdict, applyArgs, restoreArgs, effectivelyNever, timeText, manualGuide } from '../src/lib/pc.mjs'
import { styleSource } from './_ui-files.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 이 PC 에서 실제로 읽은 모양 (실측) */
const goodSettings = () => ({
  ok: true, wrote: false,
  standbyAc: 0, standbyDc: 0,
  hibernateAc: 0, hibernateDc: 2147483647,
  lidAc: null, lidDc: null,
  hibernateAvailable: false, hasBattery: true, lockedNow: false,
})
const find = (verdict, 키) => verdict.목록.find((x) => x.키 === 키)

/* ── 값 해석 ─────────────────────────────────────────────────── */

test('0 은 "안 함"이다', () => {
  assert.equal(effectivelyNever(0), true)
  assert.equal(timeText(0), '안 함')
})

test('🔴 큰 값도 사실상 "안 함"이다 (OEM 이 2147483647 을 쓴다 — 실측)', () => {
  assert.equal(effectivelyNever(2147483647), true)
  assert.equal(timeText(2147483647), '안 함')
})

test('🔴 못 읽은 값(null)은 0 과 다르다 — "모름"이다', () => {
  assert.equal(effectivelyNever(null), false, 'null 을 "안 함"으로 보면 잠드는 PC 를 괜찮다고 한다')
  assert.equal(timeText(null), '모름')
})

test('실제 대기 시간은 사람이 읽게 적는다', () => {
  assert.equal(timeText(600), '10분 뒤')
  assert.equal(timeText(1800), '30분 뒤')
  assert.equal(timeText(7200), '2시간 뒤')
})

/* ── 판정 ────────────────────────────────────────────────────── */

test('🔴 전원 연결 상태에서 잠들면 치명이다 (감시가 그때 멎는다)', () => {
  const d = goodSettings(); d.standbyAc = 600
  const v = pcVerdict(d)
  assert.equal(v.수준, 'crit')
  const x = find(v, 'standbyAc')
  assert.equal(x.수준, 'crit')
  assert.match(x.왜, /예약 작업을 돌리지 않는다/, '왜 문제인지 말해야 한다')
  assert.equal(x.고칠수있나, true)
})

test('잠들지 않으면 통과', () => {
  const v = pcVerdict(goodSettings())
  assert.equal(find(v, 'standbyAc').수준, 'ok')
})

test('🔴 최대 절전이 꺼져 있으면 그 값으로 경고하지 않는다 (발동할 수 없다)', () => {
  const d = goodSettings(); d.hibernateAvailable = false; d.hibernateAc = 600
  assert.equal(find(pcVerdict(d), 'hibernateAc').수준, 'ok')
})

test('최대 절전이 켜져 있고 시간이 걸려 있으면 치명이다', () => {
  const d = goodSettings(); d.hibernateAvailable = true; d.hibernateAc = 1800
  assert.equal(find(pcVerdict(d), 'hibernateAc').수준, 'crit')
})

test('🔴 덮개 설정을 못 읽으면 "모름"이다 — 괜찮다고 하지 않는다', () => {
  const v = pcVerdict(goodSettings())          // 이 PC 는 덮개 항목이 없다(실측)
  const x = find(v, 'lidAc')
  assert.equal(x.수준, 'unknown')
  assert.ok(!x.고칠수있나, '읽지도 못하는 값을 고치려 들면 안 된다')
  assert.match(x.왜, /직접 확인/, '무엇을 하라는지 말해야 한다')
})

test('덮개가 절전이면 경고하되 치명은 아니다 (덮고 나가지 않으면 무해하다)', () => {
  const d = goodSettings(); d.lidAc = 1
  const x = find(pcVerdict(d), 'lidAc')
  assert.equal(x.수준, 'warn')
  assert.equal(x.고칠수있나, true)
})

test('데스크톱에는 덮개 줄을 만들지 않는다', () => {
  const d = goodSettings(); d.hasBattery = false
  assert.equal(find(pcVerdict(d), 'lidAc'), undefined)
})

/**
 * 🔴 배터리에서 절전을 끄면 배터리를 태운다. 그건 사용자의 PC 이지 우리 것이 아니다.
 */
test('🔴 배터리 설정은 보여주기만 하고 고치지 않는다', () => {
  // 덮개는 읽힌 것으로 고정한다 — 배터리 하나만 변수로 두기 위해서다
  const d = goodSettings(); d.standbyDc = 900; d.lidAc = 0
  const v = pcVerdict(d)
  const x = find(v, 'standbyDc')
  assert.equal(x.수준, 'info', '배터리 절전은 경고가 아니다 — 그게 맞는 동작이다')
  assert.ok(!v.고칠것.includes('standbyDc'), '배터리 값을 자동으로 바꾸면 안 된다')
  assert.equal(v.수준, 'ok', '배터리 절전만으로 전체 판정이 나빠지면 안 된다')
})

test('🔴 설정을 못 읽으면 괜찮다고 하지 않는다 (fail-closed)', () => {
  for (const s of [null, undefined, {}, { ok: false, 오류: 'powershell 없음' }]) {
    const v = pcVerdict(s)
    assert.equal(v.읽음, false)
    assert.equal(v.수준, 'unknown')
    assert.equal(v.고칠것.length, 0, '모르는 채로 고치려 들면 안 된다')
  }
})

/* ── 적용·복원 인자 ──────────────────────────────────────────── */

test('🔴 적용 인자에 배터리(Dc)가 절대 섞이지 않는다', () => {
  const a = applyArgs(['standbyAc', 'hibernateAc', 'lidAc', 'standbyDc'])
  assert.ok(!a.some((x) => /Dc$/.test(x)), `배터리 인자가 섞였다: ${a.join(' ')}`)
  assert.deepEqual(a, ['-StandbyAc', '0', '-HibernateAc', '0', '-LidAc', '0'])
})

test('고칠 것이 없으면 인자도 없다', () => {
  assert.deepEqual(applyArgs([]), [])
})

test('🔴 복원은 백업에 있는 값만 되돌린다 (없는 값을 0 으로 만들지 않는다)', () => {
  assert.deepEqual(restoreArgs({ standbyAc: 600, hibernateAc: 0, lidAc: null }),
    ['-StandbyAc', '600', '-HibernateAc', '0'])
  assert.deepEqual(restoreArgs({}), [])
  assert.deepEqual(restoreArgs(null), [])
})

/* ── 안전 규칙이 코드에 남아 있는가 ─────────────────────────── */

const pcmjs = readFileSync(join(ROOT, 'src', 'pc.mjs'), 'utf8')
const libpc = readFileSync(join(ROOT, 'src', 'lib', 'pc.mjs'), 'utf8')
const ps1 = readFileSync(join(ROOT, 'scripts', 'pc-settings.ps1'), 'utf8')

test('🔴 기본 동작은 점검이다 — 묻지도 않고 바꾸지 않는다', () => {
  assert.match(pcmjs, /if \(!flag\('--apply'\)\)/, '--apply 없이는 바꾸지 않아야 한다')
})

test('🔴 바꾸기 전에 되돌릴 길을 먼저 만든다', () => {
  const i = pcmjs.indexOf('writeJsonAtomic(backupPath')
  const j = pcmjs.indexOf('applyArgs(verdict.고칠것)')
  assert.ok(i > 0 && j > 0, '백업과 적용을 모두 찾아야 한다')
  assert.ok(i < j, '백업이 적용보다 먼저여야 한다 — 되돌릴 수 없는 변경은 하지 않는다')
  assert.match(pcmjs, /되돌리기 기록을 저장하지 못했다[\s\S]{0,200}process\.exit\(1\)/,
    '백업에 실패하면 바꾸지 않고 끝내야 한다')
})

test('🔴 바꾼 뒤 다시 읽어 확인한다 (바꿨다고 말만 하면 안 된다)', () => {
  assert.match(pcmjs, /const after = readPs\(applyArgs/, '적용 후 다시 읽어야 한다')
  assert.match(pcmjs, /바꿨는데도 남아 있다/, '안 바뀌었으면 그렇게 말해야 한다')
})

test('🔴 .ps1 은 순수 ASCII 다', () => {
  for (const [i, b] of Buffer.from(ps1, 'utf8').entries()) {
    assert.ok(b <= 0x7f, `pc-settings.ps1 의 ${i}번째 바이트가 ASCII 가 아니다`)
  }
})

test('🔴 값 읽기는 로케일 라벨이 아니라 자리로 한다 (schtasks cp949 교훈)', () => {
  assert.match(ps1, /hex\[\$hex\.Count - 2\]/, '마지막 두 hex 를 AC/DC 로 읽어야 한다')
  assert.ok(!/Select-String 'AC |Current AC/.test(ps1), '영문 라벨에 기대면 한글 Windows 에서 깨진다')
})

test('🔴 별칭이 아니라 GUID 를 쓴다 (별칭은 PC 마다 없을 수 있다 — 실측)', () => {
  assert.match(ps1, /238c9fa8-0aad-41ed-83f4-97be242c8f20/, 'SUB_SLEEP GUID')
  assert.match(ps1, /29f6c1db-86da-48c5-9fdb-f2b67b1f44da/, 'STANDBYIDLE GUID')
})

test('창을 띄우지 않고 부른다 (읽기는 lib 에 있다)', () => {
  assert.match(libpc, /windowsHide: true/)
})

test('수동 안내가 실제 경로를 짚는다', () => {
  const t = manualGuide().join('\n')
  assert.match(t, /전원 옵션/)
  assert.match(t, /덮개/)
  assert.match(t, /로그오프/, '잠금과 로그오프의 차이를 말해야 한다')
})

/* ── 화면에서 바꿀 수 있는가 ────────────────────────────────── */

/**
 * 바꾸는 단추는 '설정' 모달(setup.js)에 있고, 요약(summary.js)에는 **여는 단추**만
 * 있다 — 같은 동작을 두 곳에 두면 어느 쪽이 최신인지 알 수 없다.
 * 이 시험들은 "화면이 무엇을 한다"를 보므로 화면 스크립트를 함께 읽는다.
 */
const uiSrc = ['app.js', 'summary.js', 'setup.js']
  .map((f) => readFileSync(join(ROOT, 'src', 'ui', f), 'utf8')).join('\n')

/**
 * 🔴 문제를 보는 자리와 고치는 자리가 같아야 한다.
 *   고치는 법이 CLI 에만 있으면, 화면만 보는 사람은 "감시 정상"을 보면서
 *   자리를 비우는 순간 멎을 PC 를 그대로 쓴다.
 */
test('🔴 화면에 PC 설정 묶음이 있다', () => {
  assert.match(uiSrc, /group\('PC 설정'\)/, 'PC 설정 묶음을 그려야 한다')
  assert.match(uiSrc, /pc\.목록/, '판정 목록을 줄로 그려야 한다')
})

test('🔴 자동 설정·되돌리기·수동 방법이 모달 안에 다 있다', () => {
  assert.match(uiSrc, /dataset\.pc = /, '단추가 동작을 달아야 한다')
  for (const act of ['apply', 'restore', 'manual', 'set']) {
    assert.ok(uiSrc.includes(`'${act}'`), `${act} 동작이 없다`)
  }
  assert.match(uiSrc, /권장값으로 \(/, '권장값 적용 단추')
  assert.match(uiSrc, /고른 값 적용/, '직접 고른 값을 적용하는 단추')
  assert.match(uiSrc, /되돌리기/)
  assert.match(uiSrc, /수동 설정 방법/)
})

/**
 * 🔴 자동과 수동을 **한 화면에** 둔다.
 *   자동으로 고칠 수 있는 것과 손으로 해야 하는 것이 섞여 있다(이 PC 는 덮개
 *   항목이 전원 구성에 아예 없어 영원히 '모름'이다). 자동만 보여주면 남은 것을
 *   놓치고, 수동만 보여주면 할 수 있는 걸 안 한다.
 */
test("🔴 '설정' 단추가 머리말에 있고 모달을 연다", () => {
  const html = styleSource()
  assert.match(html, /id="btnSetup"/, "머리말에 '설정' 단추가 있어야 한다")
  // '밝게' 오른쪽 — 사용자가 지정한 자리다
  assert.ok(html.indexOf('id="btnTheme"') < html.indexOf('id="btnSetup"'),
    "'설정' 은 '밝게' 오른쪽이어야 한다")
  assert.match(html, /id="setupWrap"[^>]*role="dialog"[^>]*aria-modal="true"/,
    '모달은 dialog 로 알려야 한다')
  assert.match(uiSrc, /\$\('#btnSetup'\)\.addEventListener/, '단추가 모달을 열어야 한다')
})

test('🔴 모달은 사라져야 한다 — 바깥 클릭과 Esc', () => {
  assert.match(uiSrc, /e\.target\.id === 'setupWrap'/, '배경을 누르면 닫혀야 한다')
  assert.match(uiSrc, /e\.key === 'Escape'/, 'Esc 로 닫혀야 한다')
  const html = styleSource()
  assert.match(html, /id="btnSetupClose"/, '닫기 단추도 있어야 한다')
  assert.match(uiSrc, /\$\('#btnSetupClose'\)\.addEventListener/, '닫기 단추가 실제로 닫아야 한다')
})

test('모달 본문은 자기 스크롤을 갖는다 (화면이 낮아도 잘리지 않게)', () => {
  const html = styleSource()
  assert.match(html, /\.sheet-bd\{[^}]*overflow-y:\s*auto/)
  assert.match(html, /\.sheet-bd\{[^}]*min-height:\s*0/,
    'min-height:0 이 없으면 flex 안에서 스크롤이 조용히 사라진다')
})

test('🔴 요약에는 여는 단추만 둔다 (같은 동작을 두 곳에 두지 않는다)', () => {
  const sum = readFileSync(join(ROOT, 'src', 'ui', 'summary.js'), 'utf8')
  assert.match(sum, /PC 설정 열기/, '요약에는 여는 단추가 있어야 한다')
  assert.ok(!/dataset\.pc = 'apply'/.test(sum), '요약에서 바로 적용하면 안 된다 — 모달에서 설명과 함께')
  assert.ok(!/dataset\.pc = 'restore'/.test(sum), '되돌리기도 모달에 둔다')
})

test('상태를 새로 받으면 열려 있는 모달도 다시 그린다 (적용 결과가 바로 보이게)', () => {
  assert.match(uiSrc, /drawSettings\(\)/, '그리기 경로에 모달 갱신이 있어야 한다')
  assert.match(uiSrc, /if \(!isSettingsOpen\(\)\) return/, '닫혀 있으면 그리지 않아야 한다')
})

test('🔴 보관된 이전 값을 화면이 보여준다 (되돌릴 길을 모르면 누르지 못한다)', () => {
  assert.match(uiSrc, /백업\.있음/, '보관 여부를 봐야 한다')
  assert.match(uiSrc, /보관됨/, '보관됐다는 것을 글로도 적어야 한다')
  assert.match(uiSrc, /백업\.오류 \? badge\('warn', '▲', '파일 손상'\)/,
    '깨진 백업을 "있음"이라 하면 되돌리기가 헛돈다')
  // 🔴 이 줄은 **모달에만** 있다. 요약에도 뒀더니 옮긴 뒤 한쪽이 죽은 코드로 남아
  //   ReferenceError 를 냈고, 세션 목록이 통째로 비었다(2026-09-22 실측).
  const sum = readFileSync(join(ROOT, 'src', 'ui', 'summary.js'), 'utf8')
  assert.ok(!/백업\./.test(sum), '요약은 백업 상태를 다시 적지 않는다 — 모달의 일이다')
})

test('🔴 되돌리기 단추는 보관된 값이 있을 때만 나온다', () => {
  const i = uiSrc.indexOf("'되돌리기'")
  assert.ok(i > 0)
  const before = uiSrc.slice(Math.max(0, i - 400), i)
  assert.match(before, /백업\.있음/, '보관이 없으면 되돌리기를 보여주면 안 된다')
})

test('🔴 바꾸기 전에 확인을 받고, 되돌릴 수 있다고 말한다', () => {
  const i = uiSrc.indexOf('async function pcAction')
  const section = uiSrc.slice(i, i + 1200)
  assert.match(section, /confirm\(question\)/, '묻지 않고 바꾸면 안 된다')
  assert.match(section, /되돌릴 수 있습니다/, '되돌릴 수 있다는 것을 알려야 누를 수 있다')
  assert.match(section, /배터리 설정은 건드리지 않습니다/, '무엇을 건드리지 않는지도 말해야 한다')
})

test('수동 안내는 서버를 부르지 않는다 (모달이 이미 받아 둔 문구를 보여준다)', () => {
  const i = uiSrc.indexOf('async function pcAction')
  const section = uiSrc.slice(i, i + 400)
  assert.match(section, /action === 'manual'/)
  assert.match(section, /openSettings\(\)/, '모달을 열면 접힌 안내가 거기 있다')
  assert.match(uiSrc, /pc\.안내/, '상태에 실려 온 안내를 써야 한다')
})

test('🔴 자동으로 못 바꾸는 것이 있으면 수동 안내를 펼쳐 보여준다', () => {
  const setup = readFileSync(join(ROOT, 'src', 'ui', 'setup.js'), 'utf8')
  assert.match(setup, /needsManual/, '손으로 할 일이 남았는지 판단해야 한다')
  assert.match(setup, /d\.open = true/, '할 일이 있으면 접힌 채로 두면 안 된다')
})

/* ── 잠들도록 설정돼 있으면 경보 ────────────────────────────── */

test('🔴 PC 가 잠들도록 설정돼 있으면 경보를 낸다', async () => {
  const { currentAlerts } = await import('../src/lib/alerts.mjs')
  const d = {
    세션: [], 작업: {}, 락: {}, 합계: { 실행여부앎: true },
    pc: { 수준: 'crit', 목록: [{ 이름: '절전 (전원 연결)', 현재: '10분 뒤', 수준: 'crit' }] },
  }
  const hit = currentAlerts(d).find((x) => x.코드 === 'PC절전')
  assert.ok(hit, '지금 기록이 멀쩡해도 자리를 비우면 멎는다 — 알려야 한다')
  assert.equal(hit.수준, 'critical')
  assert.match(hit.설명, /10분 뒤/, '무엇이 문제인지 값으로 말해야 한다')
  assert.match(hit.설명, /-Pc -Apply|PC 설정/, '고치는 법을 적어야 한다')
})

test('PC 설정이 괜찮으면 그 경보는 없다', async () => {
  const { currentAlerts } = await import('../src/lib/alerts.mjs')
  const d = { 세션: [], 작업: {}, 락: {}, 합계: { 실행여부앎: true }, pc: { 수준: 'ok', 목록: [] } }
  assert.equal(currentAlerts(d).find((x) => x.코드 === 'PC절전'), undefined)
})

test('🔴 읽지 못한 경우(unknown)로는 경보를 내지 않는다 (끝없는 경보 금지)', async () => {
  const { currentAlerts } = await import('../src/lib/alerts.mjs')
  const d = { 세션: [], 작업: {}, 락: {}, 합계: { 실행여부앎: true }, pc: { 수준: 'unknown', 목록: [] } }
  assert.equal(currentAlerts(d).find((x) => x.코드 === 'PC절전'), undefined,
    '이 PC 는 덮개 항목이 없어 영원히 unknown 이다 — 매번 경보면 진짜 문제가 묻힌다')
})

test('🔴 캐시 경로에서도 백업·안내가 실려온다 (빠뜨려 단추가 빈 채로 떴다 — 실측)', async () => {
  const { pcState } = await import('../src/lib/pc.mjs')
  const first = pcState({ force: true })
  const second = pcState()          // 캐시 경로
  assert.equal(second.캐시됨, true, '두 번째는 캐시를 타야 한다')
  for (const k of ['백업', '안내']) {
    assert.ok(first[k], `강제 경로에 ${k} 가 없다`)
    assert.ok(second[k], `캐시 경로에 ${k} 가 없다 — 화면 단추가 빈 채로 뜬다`)
  }
  assert.ok(second.안내.length > 0, '안내가 비어 있으면 수동 설명 단추가 아무것도 못 보여준다')
})

test('🔴 정상인 줄에 "자동으로는 못 바꿉니다"를 붙이지 않는다 (능력 문제로 읽힌다)', () => {
  const setup = readFileSync(join(ROOT, 'src', 'ui', 'setup.js'), 'utf8')
  // 문제가 있을 때만 고칠 수 있는지를 말한다
  assert.match(setup, /const trouble = x\.수준 !== 'ok' && x\.수준 !== 'info'/,
    '정상·정보 줄은 고침 가능 여부를 말할 필요가 없다')
  assert.match(setup, /!trouble \? ''/, '정상이면 꼬리를 붙이지 않아야 한다')
})
