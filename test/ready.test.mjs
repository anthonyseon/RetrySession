/**
 * ready.test.mjs — «이 PC 에서 돌 수 있나» 판정과 «이 PC 준비하기» 단계를 고정한다.
 *
 * 🔴 실측 (2026-10-01): 다른 PC 에서 복사해 온 PC 에서 start.exe 를 눌러도 아무 일이 없었다 —
 *   node 없음 · 예약 0개 · 5분 절전 · 그 PC 경로의 설정이 겹쳐 있었다. 이 판정이 그것을 한 번에 말한다.
 * 🔴 모르면 준비됐다고 하지 않는다 — «모를 때» 를 따로 센다.
 * 🔴 단추는 돈을 쓰는 것(재시작 작업)을 어떤 경우에도 고치지 않는다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readyVerdict, applySteps, runSteps, nodeOnPath } from '../src/lib/ready.mjs'

const task = (over = {}) => ({ registered: true, healthy: true, isRunning: false, stopped: false, resultText: '성공', ...over })
const pcOk = () => ({ read: true, level: 'ok', items: [{ key: 'standbyAc', name: '절전 (전원 연결)', level: 'ok', current: '안 함', why: '' }], fixable: [] })
const good = () => ({
  node: { version: 'v24.21.0', dir: 'C:\\Program Files\\nodejs', onPath: true },
  exe: { runhidden: true, start: true, csc: true },
  tasks: { heartbeat: task(), UI: task({ isRunning: true }), tray: task({ isRunning: true }), restart: task() },
  pc: pcOk(),
  account: { ok: true, loggedIn: true, email: 'a@b.c', error: null },
  cli: { installed: true },
  config: { count: 1, missing: [], error: null },
  resumeOn: 0,
})
const at = (v, k) => v.items.find((i) => i.key === k)

/* ── 판정 ────────────────────────────────────────────────────── */

test('다 갖추면 준비됨이고 고칠 것이 없다', () => {
  const v = readyVerdict(good())
  assert.equal(v.level, 'ok')
  assert.equal(v.ready, true)
  assert.deepEqual(v.fixable, [])
  assert.ok(v.items.every((i) => i.level === 'ok'), v.items.filter((i) => i.level !== 'ok').map((i) => i.key).join(','))
})

test('🔴 아무것도 모르면 준비됐다고 하지 않는다 (fail-closed)', () => {
  const v = readyVerdict({})
  assert.notEqual(v.level, 'ok')
  assert.equal(v.ready, false)
  assert.ok(!v.items.some((i) => i.level === 'ok'), '모르는 것을 ok 로 읽었다')
})

test('🔴 예약 조회가 실패하면 «미등록» 이 아니라 «모름» 이고, 단추가 다시 등록하지 않는다', () => {
  const x = good()
  x.tasks = { heartbeat: { queryFailed: true, registered: null, error: '시간 초과' }, UI: task(), tray: task(), restart: task() }
  const v = readyVerdict(x)
  assert.equal(at(v, 'heartbeat').level, 'unknown')
  assert.match(at(v, 'heartbeat').why, /시간 초과/)
  assert.ok(!v.fixable.includes('heartbeat'), '있는 작업을 없다고 보고 다시 등록하면 안 된다')
  assert.equal(v.ready, false)
})

test('감시 작업이 없으면 안 됨, 화면·트레이가 없으면 주의 — 셋 다 단추가 고친다', () => {
  const x = good()
  x.tasks = { heartbeat: task({ registered: false }), UI: task({ registered: false }), tray: task({ registered: false }), restart: task() }
  const v = readyVerdict(x)
  assert.equal(at(v, 'heartbeat').level, 'crit')
  assert.equal(at(v, 'UI').level, 'warn')
  assert.equal(at(v, 'tray').level, 'warn')
  for (const k of ['heartbeat', 'UI', 'tray']) assert.ok(v.fixable.includes(k), k)
  assert.equal(v.level, 'crit')
})

test('등록됐지만 마지막 회차가 실패한 작업은 주의 — 다시 등록하지 않고 진단을 가리킨다', () => {
  const x = good()
  x.tasks.heartbeat = task({ healthy: false, resultText: '오류(1)' })
  const v = readyVerdict(x)
  assert.equal(at(v, 'heartbeat').level, 'warn')
  assert.equal(at(v, 'heartbeat').fix, 'manual')
  assert.match(at(v, 'heartbeat').now, /오류\(1\)/)
})

test('runhidden.exe 가 없으면 안 됨 — csc 가 있으면 단추가, 없으면 사람이', () => {
  const x = good()
  x.exe = { runhidden: false, start: false, csc: true }
  assert.equal(at(readyVerdict(x), 'exe').level, 'crit')
  assert.equal(at(readyVerdict(x), 'exe').fix, 'auto')
  x.exe.csc = false
  const it = at(readyVerdict(x), 'exe')
  assert.equal(it.fix, 'manual')
  assert.match(it.how, /start\.ps1/)
  x.exe = { runhidden: true, start: false, csc: true }
  assert.equal(at(readyVerdict(x), 'exe').level, 'warn', 'start.exe 만 없으면 예약은 돈다')
})

test('node — 낡으면 안 됨, 새 창의 PATH 에 없으면 주의, PATH 를 못 읽으면 모름', () => {
  const x = good()
  x.node = { version: 'v18.19.0', dir: 'C:\\n', onPath: true }
  assert.equal(at(readyVerdict(x), 'node').level, 'crit')
  x.node = { version: 'v24.1.0', dir: 'C:\\n', onPath: false }
  const off = at(readyVerdict(x), 'node')
  assert.equal(off.level, 'warn')
  assert.match(off.how, /C:\\n/, '어느 폴더를 넣어야 하는지 말해야 한다')
  x.node.onPath = null
  assert.equal(at(readyVerdict(x), 'node').level, 'unknown')
  x.node = { version: '', onPath: true }
  assert.equal(at(readyVerdict(x), 'node').level, 'unknown')
})

test('전원 — 잠들면 안 됨(단추가 고침), 항목 하나만 모르면 주의, 아예 못 읽으면 모름', () => {
  const x = good()
  x.pc = { read: true, level: 'crit', fixable: ['standbyAc'],
    items: [{ key: 'standbyAc', name: '절전 (전원 연결)', level: 'crit', current: '5분 뒤', why: '5분 뒤 잠든다' }] }
  const crit = at(readyVerdict(x), 'power')
  assert.equal(crit.level, 'crit')
  assert.equal(crit.fix, 'auto')
  assert.match(crit.now, /5분 뒤/)
  // 이 PC 실측: 덮개 항목이 숨어 있어 «모름» 이다 — 그것 때문에 영영 «준비 모름» 이 되면 안 된다
  x.pc = { read: true, level: 'unknown', fixable: [], items: [...pcOk().items,
    { key: 'lidAc', name: '덮개 닫기 (전원 연결)', level: 'unknown', current: '모름', why: '덮개 항목이 없다' }] }
  const lid = at(readyVerdict(x), 'power')
  assert.equal(lid.level, 'warn')
  assert.equal(lid.fix, 'manual')
  assert.equal(readyVerdict(x).ready, true)
  x.pc = { read: false, items: [{ why: '설정을 읽지 못했다 — 거부' }] }
  assert.equal(at(readyVerdict(x), 'power').level, 'unknown')
})

test('Claude — CLI 가 없으면 안 됨, 로그인이 없으면 주의(감시는 돈다), 계정을 못 읽으면 모름', () => {
  const x = good()
  x.cli = { installed: false }
  assert.equal(at(readyVerdict(x), 'claude').level, 'crit')
  x.cli = { installed: true }
  x.account = { ok: false, loggedIn: false, error: null }
  assert.equal(at(readyVerdict(x), 'claude').level, 'warn')
  assert.match(at(readyVerdict(x), 'claude').how, /API 키는 쓰지 않는다/)
  x.account = { ok: false, loggedIn: false, error: 'spawn ENOENT' }
  assert.equal(at(readyVerdict(x), 'claude').level, 'unknown')
})

test('설정 — 이 PC 에 없는 저장소는 주의, projects.local.json 은 «대체» 된다고 말한다', () => {
  const x = good()
  x.config = { count: 1, missing: [{ id: 'Description', repo: 'C:/AnthoySeon/x' }], error: null }
  const it = at(readyVerdict(x), 'config')
  assert.equal(it.level, 'warn')
  assert.match(it.now, /Description/)
  assert.match(it.how, /projects\.local\.json/)
  assert.match(it.how, /대체/, '합쳐진다고 믿으면 defaults 를 잃는다')
  x.config = { count: 0, missing: [], error: '설정 JSON 이 깨졌다' }
  assert.equal(at(readyVerdict(x), 'config').level, 'crit')
})

test('🔴 재시작 작업은 어떤 경우에도 단추가 등록하지 않는다 (사람 없이 토큰을 쓴다)', () => {
  const x = good()
  x.tasks.restart = task({ registered: false })
  const quiet = readyVerdict(x)
  assert.equal(at(quiet, 'restart').level, 'info', '켠 세션이 없으면 선택일 뿐이다')
  assert.equal(quiet.level, 'ok', '선택 항목이 준비를 막으면 안 된다')
  x.resumeOn = 2
  const it = at(readyVerdict(x), 'restart')
  assert.equal(it.level, 'warn')
  assert.match(it.now, /2개/)
  assert.match(it.how, /-WithResume/)
  for (const v of [quiet, readyVerdict(x)]) {
    assert.ok(!v.fixable.includes('restart'))
    assert.ok(!applySteps(v).some((s) => /resume/i.test(s.ps || '')), '재시작 등록 단계가 끼었다')
  }
})

test('수준은 안 됨 > 모름 > 주의 > 됨 — 주의만 있으면 준비됨이다', () => {
  const x = good()
  x.tasks.UI = task({ registered: false })
  assert.equal(readyVerdict(x).level, 'warn')
  assert.equal(readyVerdict(x).ready, true)
  x.node.onPath = null
  assert.equal(readyVerdict(x).level, 'unknown')
  x.tasks.heartbeat = task({ registered: false })
  assert.equal(readyVerdict(x).level, 'crit')
})

test('판정에 쓴 값의 나이를 싣는다 — 모르면 null 이다(0초 «방금» 이라고 하지 않는다)', () => {
  const x = good()
  x.tasks.ageMs = 12400
  x.pc.ageSec = 40
  assert.deepEqual(readyVerdict(x).asOf, { tasksSec: 12, pcSec: 40 })
  assert.deepEqual(readyVerdict({}).asOf, { tasksSec: null, pcSec: null })
})

/* ── 단계 ────────────────────────────────────────────────────── */

const broken = () => {
  const x = good()
  x.exe = { runhidden: false, start: false, csc: true }
  x.tasks = { heartbeat: task({ registered: false }), UI: task({ registered: false }), tray: task({ registered: false }), restart: task({ registered: false }) }
  x.pc = { read: true, level: 'crit', fixable: ['standbyAc'], items: [{ key: 'standbyAc', name: '절전', level: 'crit', current: '5분 뒤', why: 'x' }] }
  return readyVerdict(x)
}

test('🔴 exe 를 먼저 만들고, 상태 화면은 띄우지 않고(-NoStart) 등록하고, 전원은 마지막이다', () => {
  const steps = applySteps(broken())
  assert.deepEqual(steps.map((s) => s.key), ['exe', 'heartbeat', 'UI', 'tray', 'power'])
  assert.deepEqual(steps.find((s) => s.key === 'UI').args, ['-NoStart'],
    '포트를 비우면 이 요청을 처리하는 서버 자신이 죽는다')
  for (const k of ['heartbeat', 'UI', 'tray']) assert.equal(steps.find((s) => s.key === k).needs, 'exe')
  assert.deepEqual(steps.find((s) => s.key === 'power').args, ['--apply'])
})

test('exe 가 있으면 등록은 그것에 기대지 않고, 고칠 것이 없으면 단계도 없다', () => {
  const x = good()
  x.tasks.heartbeat = task({ registered: false })
  const steps = applySteps(readyVerdict(x))
  assert.deepEqual(steps.map((s) => s.key), ['heartbeat'])
  assert.equal(steps[0].needs, null)
  assert.deepEqual(applySteps(readyVerdict(good())), [])
  assert.deepEqual(applySteps(null), [])
})

test('🔴 exe 를 못 만들면 등록은 건너뛰고(콘솔 창 작업을 만들지 않는다) 전원은 돈다', async () => {
  const ran = []
  const r = await runSteps(applySteps(broken()), async (s) => { ran.push(s.key); return { ok: s.key !== 'exe', exit: s.key === 'exe' ? 1 : 0, output: 'csc 실패' } })
  assert.deepEqual(ran, ['exe', 'power'])
  assert.equal(r.ok, false)
  const skipped = r.results.filter((x) => x.skipped).map((x) => x.key)
  assert.deepEqual(skipped, ['heartbeat', 'UI', 'tray'])
  assert.match(r.results.find((x) => x.key === 'tray').output, /콘솔 창/)
  assert.equal(r.results.find((x) => x.key === 'power').ok, true)
})

test('단계가 던져도 멈추지 않고 실패로 적는다 · 출력은 마지막 몇 줄만 남긴다', async () => {
  const long = Array.from({ length: 20 }, (_, i) => `줄${i}`).join('\n')
  const r = await runSteps([{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }],
    async (s) => { if (s.key === 'a') throw new Error('터졌다'); return { ok: true, exit: 0, output: long } })
  assert.deepEqual(r.results.map((x) => x.ok), [false, true])
  assert.match(r.results[0].output, /터졌다/)
  assert.ok(!r.results[1].output.includes('줄0'), '앞줄까지 다 보내면 화면이 넘친다')
  assert.match(r.results[1].output, /줄19/)
})

/* ── 새 창의 PATH ────────────────────────────────────────────── */

test('새 창의 PATH 에서 node.exe 를 찾는다 — 못 읽었으면 null 이다(«없다» 가 아니다)', () => {
  const has = (p) => p.replace(/\\/g, '/').toLowerCase() === 'c:/program files/nodejs/node.exe'
  assert.equal(nodeOnPath('C:\\Windows;C:\\Program Files\\nodejs', has), true)
  assert.equal(nodeOnPath('C:\\Windows;C:\\Program Files\\Git\\cmd', has), false)
  assert.equal(nodeOnPath(null, has), null)
  assert.equal(nodeOnPath(undefined, has), null)
  process.env.RS_TEST_NODE_DIR = 'C:\\Program Files\\nodejs'
  assert.equal(nodeOnPath('%RS_TEST_NODE_DIR%', has), true, '%VAR% 를 펼쳐야 한다')
})
