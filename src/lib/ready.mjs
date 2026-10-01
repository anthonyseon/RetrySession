/**
 * ready.mjs — **이 PC 가 RetrySession 을 돌릴 수 있는가** 를 한 곳에서 판정하고, 고칠 수 있는 것을 고친다.
 *
 * 왜 필요한가 (실측 2026-10-01)
 *   다른 PC 에서 폴더째 복사해 온 PC 에서 start.exe 를 눌러도 아무 일이 없었다. 원인 넷이
 *   겹쳐 있었다 — node 없음 · 예약 작업 0개 · 전원 5분 절전 · 그 PC 경로의 설정. 각각은
 *   요약 타일·경보·진단 스킬에 흩어져 있었고, «이 PC 에서 돌 수 있나» 를 한 번에 말하는
 *   곳이 없었다. 사람이 진단 절차를 따라가야 알 수 있었다.
 *
 * 🔴 판정은 순수 함수(readyVerdict)다. 읽기는 readyInputs, 고치기는 applySteps·runSteps.
 *   pc.mjs · scheduler.mjs 와 같은 분리다 — 그래야 «모를 때» 를 시험할 수 있다.
 * 🔴 모르면 준비됐다고 하지 않는다(fail-closed). 조회 실패는 `unknown` 이지 `ok` 가 아니다.
 * 🔴 고치는 것은 **되돌릴 수 있고 돈을 쓰지 않는 것만**이다 — exe 빌드 · 감시/화면/트레이 예약
 *   등록 · 전원(AC 만, 백업 후). 재시작 작업은 사람 없이 토큰을 쓰므로 등록하지 않는다
 *   (`-Install -WithResume` 를 명시해야 한다 — start.ps1 과 같은 정책). 로그인·설정 경로·PATH 는
 *   사람의 것이라 방법만 적는다.
 */
import { existsSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { RS_HOME, loadConfig } from './config.mjs'
import { claudeInstalls, account, refreshAccount } from './cli.mjs'
import { taskState, refreshTasks } from './scheduler.mjs'
import { pcState, clearCache as clearPcCache } from './pc.mjs'

const MIN_NODE = 20

/** @param fix 'auto' — 단추가 고친다 · 'manual' — 사람이 고친다(how 에 방법) · null — 고칠 것 없음 */
const item = (key, name, level, now, why, fix = null, how = null) => ({ key, name, level, now, why, fix, how })

/* ── 판정 (순수) ─────────────────────────────────────────────── */

function nodeItem(n) {
  const major = Number(String(n?.version || '').replace(/^v/, '').split('.')[0])
  if (!major) return item('node', 'Node.js', 'unknown', '모름', '버전을 읽지 못했다', 'manual', 'Node.js 20 이상을 설치한다')
  if (major < MIN_NODE) {
    return item('node', 'Node.js', 'crit', n.version, `${MIN_NODE} 이상이어야 한다`,
      'manual', 'Node.js LTS 를 설치한다 — winget install OpenJS.NodeJS.LTS')
  }
  // 🔴 새 창이 node 를 못 찾으면 start.exe 더블클릭이 **아무 말 없이** 끝난다(창이 숨겨져 있다).
  //   예약 작업은 등록할 때 잡은 절대 경로를 쓰므로 돈다 — 그래서 막지 않고 주의로 둔다.
  if (n.onPath === false) {
    return item('node', 'Node.js', 'warn', `${n.version} · 새 창의 PATH 에 없음`,
      'start.exe 는 PATH 에서 node 를 찾는다 — 더블클릭해도 아무 일이 없다(오류도 안 보인다)',
      'manual', `PATH 에 ${n.dir} 를 넣거나 Node.js 를 다시 설치한다`)
  }
  if (n.onPath !== true) {
    return item('node', 'Node.js', 'unknown', `${n.version} · PATH 확인 못 함`,
      '새 창이 node 를 찾는지 읽지 못했다', 'manual', '새 PowerShell 에서 where.exe node')
  }
  return item('node', 'Node.js', 'ok', n.version, '예약 작업과 start.exe 가 쓴다')
}

function exeItem(e) {
  if (!e) return item('exe', '실행 파일', 'unknown', '모름', '확인하지 못했다')
  if (e.runhidden && e.start) return item('exe', '실행 파일', 'ok', 'runhidden.exe · start.exe', '예약 작업이 콘솔 창 없이 돈다')
  const miss = [!e.runhidden && 'runhidden.exe', !e.start && 'start.exe'].filter(Boolean).join(' · ')
  // runhidden.exe 없이 등록한 작업은 콘솔 창을 띄운 채 돈다(실측: 트레이 창이 하루 종일 떠 있었다)
  return item('exe', '실행 파일', e.runhidden ? 'warn' : 'crit', `없음: ${miss}`,
    e.runhidden ? 'start.exe(더블클릭 진입점)가 없다' : '없이 등록한 예약 작업은 콘솔 창을 띄운 채 돈다',
    e.csc ? 'auto' : 'manual', e.csc ? null : 'csc.exe(.NET Framework 4.x)가 없다 — powershell -File start.ps1 로 대신 띄운다')
}

const TASKS = [
  ['heartbeat', '예약: 감시 (5분)', 'crit', '세션 밖에서 5분마다 기록한다 — 없으면 끊긴 것을 아무도 모른다'],
  ['UI', '예약: 상태 화면', 'warn', '로그온하면 이 화면의 서버를 띄운다 — 없으면 재부팅 뒤 화면이 없다'],
  ['tray', '예약: 트레이', 'warn', '창을 닫아도 상태를 알린다'],
]

function taskItems(tasks) {
  return TASKS.map(([key, name, missLevel, why]) => {
    const t = tasks?.[key]
    if (!t || t.queryFailed || typeof t.registered !== 'boolean') {
      return item(key, name, 'unknown', '조회 실패', `작업 스케줄러를 읽지 못했다 — ${t?.error || '이유 불명'}`)
    }
    if (!t.registered) return item(key, name, missLevel, '등록 안 됨', why, 'auto')
    if (t.healthy === false && !t.stopped) {
      return item(key, name, 'warn', `등록됨 · ${t.resultText || '마지막 결과 모름'}`, '마지막 회차가 실패로 끝났다',
        'manual', '진단: retrysession-diagnose 스킬 증상 6')
    }
    return item(key, name, 'ok', `등록됨 · ${t.isRunning ? '실행 중' : t.resultText || '대기'}`, why)
  })
}

/** 재시작 작업은 **선택**이다 — 켠 세션이 있는데 없을 때만 주의다 */
function resumeItem(t, resumeOn) {
  const name = '예약: 재시작 (선택)'
  if (!t || t.queryFailed || typeof t.registered !== 'boolean') return item('restart', name, 'unknown', '조회 실패', '작업 스케줄러를 읽지 못했다')
  if (t.registered) return item('restart', name, 'ok', '등록됨', '재시작을 켠 세션을 이어받는다')
  const how = '.\\start.exe -Install -WithResume — 사람 없이 토큰을 쓰므로 이 단추는 등록하지 않는다'
  if (resumeOn > 0) {
    return item('restart', name, 'warn', `등록 안 됨 · 재시작 켠 세션 ${resumeOn}개`,
      '재시작을 켜 둔 세션이 있는데 띄울 작업이 없다 — 이어받지 않는다', 'manual', how)
  }
  return item('restart', name, 'info', '등록 안 됨', '재시작을 쓸 때만 필요하다', null, how)
}

function powerItem(pc) {
  const name = '전원 (잠들지 않기)'
  if (!pc || pc.read === false) return item('power', name, 'unknown', '읽지 못함', pc?.items?.[0]?.why || '전원 설정을 읽지 못했다')
  const bad = (pc.items || []).filter((x) => x.level === 'crit' || x.level === 'warn')
  const unsure = (pc.items || []).filter((x) => x.level === 'unknown')
  const canFix = (pc.fixable || []).length > 0
  if (bad.length) {
    return item('power', name, bad.some((x) => x.level === 'crit') ? 'crit' : 'warn',
      bad.map((x) => `${x.name} ${x.current}`).join(' · '), bad[0].why, canFix ? 'auto' : 'manual',
      canFix ? null : '설정 창(머리말의 설정)에서 직접 고른다')
  }
  // 🔴 읽기는 됐는데 항목 하나를 모르는 것(덮개 항목이 숨은 PC)은 «못 읽음» 과 다르다 — 주의로 둔다
  if (unsure.length) {
    return item('power', name, 'warn', `직접 확인: ${unsure.map((x) => x.name).join(' · ')}`, unsure[0].why,
      'manual', '설정 창(머리말의 설정)의 «수동 설정 방법»')
  }
  return item('power', name, 'ok', '전원 연결 시 잠들지 않음', '예약 작업이 밤새 돈다')
}

function claudeItem(cli, a) {
  const name = 'Claude Code 로그인'
  if (cli && cli.installed === false) {
    return item('claude', name, 'crit', 'CLI 없음', '세션 목록·재시작이 claude CLI 를 쓴다', 'manual', 'VS Code 에 Claude Code 확장을 설치한다')
  }
  if (!a || (a.error && !a.loggedIn)) return item('claude', name, 'unknown', '확인 못 함', a?.error || '계정을 읽지 못했다')
  if (!a.loggedIn) {
    return item('claude', name, 'warn', '로그인 안 됨', '재시작(claude --resume)이 이 로그인을 쓴다 — 감시는 돈다',
      'manual', 'VS Code 에서 Claude Code 에 로그인한다(API 키는 쓰지 않는다)')
  }
  return item('claude', name, 'ok', a.email || '로그인됨', '재시작이 이 계정으로 돈다')
}

function configItem(c) {
  const name = '설정 (저장소 경로)'
  if (!c) return item('config', name, 'unknown', '모름', '설정을 확인하지 못했다')
  if (c.error) {
    return item('config', name, 'crit', '읽지 못함', c.error, 'manual', 'config/projects.json (또는 projects.local.json) 을 고친다')
  }
  if (c.missing?.length) {
    return item('config', name, 'warn', `없는 경로 ${c.missing.length}개: ${c.missing.map((m) => m.id).join(' · ')}`,
      '이 PC 에 그 저장소가 없다 — 다른 PC 에서 복사해 온 설정일 수 있다', 'manual',
      'config/projects.json 을 통째로 복사해 경로만 바꾼 config/projects.local.json 을 만든다(합쳐지지 않고 대체된다)')
  }
  return item('config', name, 'ok', `프로젝트 ${c.count}개`, '저장소 경로가 이 PC 에 있다')
}

/**
 * 판정. 순수 함수.
 * @param x { node, exe, tasks, pc, account, cli, config, resumeOn }
 * @returns {{ level, ready, items, fixable }} level: ok | warn | unknown | crit
 */
export function readyVerdict(x = {}) {
  const items = [
    nodeItem(x.node), exeItem(x.exe), ...taskItems(x.tasks), resumeItem(x.tasks?.restart, x.resumeOn || 0),
    powerItem(x.pc), claudeItem(x.cli, x.account), configItem(x.config),
  ]
  const has = (lv) => items.some((i) => i.level === lv)
  const level = has('crit') ? 'crit' : has('unknown') ? 'unknown' : has('warn') ? 'warn' : 'ok'
  // 🔴 «준비됨» 은 막는 것(crit)도 모르는 것(unknown)도 없을 때다 — 모르면 준비됐다고 하지 않는다
  return {
    level, ready: level === 'ok' || level === 'warn', items,
    fixable: items.filter((i) => i.fix === 'auto').map((i) => i.key),
    /**
     * 판정에 쓴 값이 **몇 초 전에 읽은 것인가.** 예약(30초)·전원(60초)은 캐시를 거친다 —
     * 화면이 그 나이를 말해야 «방금 등록했는데 왜 안 됨이지» 가 «다시 확인» 으로 이어진다.
     * 모르면 null 이다(0 초라고 하지 않는다).
     */
    asOf: {
      tasksSec: Number.isFinite(x.tasks?.ageMs) ? Math.round(x.tasks.ageMs / 1000) : null,
      pcSec: Number.isFinite(x.pc?.ageSec) ? x.pc.ageSec : null,
    },
  }
}

/**
 * 고칠 단계. 순수 함수. **순서가 곧 안전장치다** — exe 를 먼저 만든다
 * (없이 등록하면 콘솔 창이 뜨는 작업이 생긴다). 상태 화면은 `-NoStart`(register-ui.ps1 머리말).
 */
export function applySteps(v) {
  const want = new Set(v?.fixable || [])
  const steps = []
  const needsExe = want.has('exe') ? 'exe' : null
  if (want.has('exe')) steps.push({ key: 'exe', name: '실행 파일 만들기', ps: 'build-exe.ps1', args: [] })
  if (want.has('heartbeat')) steps.push({ key: 'heartbeat', name: '감시 예약 등록', ps: 'register-heartbeat.ps1', args: [], needs: needsExe })
  if (want.has('UI')) steps.push({ key: 'UI', name: '상태 화면 예약 등록', ps: 'register-ui.ps1', args: ['-NoStart'], needs: needsExe })
  if (want.has('tray')) steps.push({ key: 'tray', name: '트레이 예약 등록', ps: 'register-tray.ps1', args: [], needs: needsExe })
  if (want.has('power')) steps.push({ key: 'power', name: '전원 설정 (전원 연결 시 잠들지 않기)', node: 'src/pc.mjs', args: ['--apply'] })
  return steps
}

const lastLines = (s, n = 6) => String(s || '').trim().split(/\r?\n/).filter(Boolean).slice(-n).join('\n')

/**
 * 단계를 차례로 돌린다. `run` 은 시험에서 갈아 끼운다.
 * 🔴 exe 를 못 만들었으면 그것에 기대는 등록은 건너뛴다 — 콘솔 창이 뜨는 작업을 만들지 않는다.
 */
export async function runSteps(steps, run = runStep) {
  const results = []
  const failed = new Set()
  for (const s of steps) {
    if (s.needs && failed.has(s.needs)) {
      results.push({ key: s.key, name: s.name, ok: false, skipped: true,
        output: '실행 파일을 못 만들어 건너뛰었다 — runhidden.exe 없이 등록하면 콘솔 창이 뜨는 작업이 생긴다' })
      failed.add(s.key)
      continue
    }
    let r
    try { r = await run(s) } catch (e) { r = { ok: false, exit: null, output: e?.message || String(e) } }
    results.push({ key: s.key, name: s.name, ok: !!r.ok, exit: r.exit ?? null, output: lastLines(r.output) })
    if (!r.ok) failed.add(s.key)
  }
  return { ok: results.every((r) => r.ok), results }
}

/* ── 읽기·고치기 (IO) ────────────────────────────────────────── */

const powershellExe = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

/**
 * 한 단계를 **비동기로** 돌린다.
 * 🔴 spawnSync 로 돌리면 작업 등록(수 초씩)이 서버의 한 스레드를 붙잡아 /api/ping 이 멈춘다 —
 *   start.ps1·트레이가 그것을 «서버 죽음» 으로 읽는다(이 저장소가 겪은 사고다).
 * 🔴 PATH 맨 앞에 **이 서버의 node** 를 둔다 — 등록 스크립트는 `Get-Command node` 로 경로를
 *   잡는데, 설치 직후의 PC 는 PATH 가 낡아 있을 수 있다(실측). 같은 node 를 쓰게 한다.
 */
function runStep(s, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const exe = s.node ? process.execPath : powershellExe()
    const args = s.node
      ? [join(RS_HOME, s.node), ...s.args]
      : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(RS_HOME, 'scripts', s.ps), ...s.args]
    const env = { ...process.env, Path: `${dirname(process.execPath)};${process.env.Path || process.env.PATH || ''}` }
    let out = ''
    const child = spawn(exe, args, { cwd: RS_HOME, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { out += '\n(시간 초과로 멈췄다)'; child.kill() }, timeoutMs)
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, exit: null, output: e.message }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, exit: code, output: out }) })
  })
}

/** PATH 문자열에 node.exe 가 있는 폴더가 있나. 순수 함수(존재 확인만 주입한다) */
export function nodeOnPath(pathText, exists = existsSync) {
  if (typeof pathText !== 'string') return null
  const expand = (d) => d.replace(/%([^%]+)%/g, (m, k) => process.env[k] ?? m)
  return pathText.split(';').map((d) => expand(d.trim())).filter(Boolean).some((d) => exists(join(d, 'node.exe')))
}

/**
 * **새로 여는 프로세스가 보는** PATH(레지스트리의 Machine + User).
 * 이 서버의 PATH 가 아니다 — 서버는 node 가 있는 PATH 로 떴으니 늘 «있다» 고 답한다.
 * 🔴 base64 로 받는다 — PowerShell 5.1 은 파이프에 콘솔 코드페이지로 쓰므로 한글 경로가 깨진다.
 */
const _path = { at: 0, v: undefined }
function newProcessPath({ ttlMs = 5 * 60000 } = {}) {
  if (_path.v !== undefined && Date.now() - _path.at < ttlMs) return _path.v
  const ps = "$p=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User');" +
    '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p))'
  try {
    const out = execFileSync(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    _path.v = Buffer.from(out.trim(), 'base64').toString('utf8')
  } catch { _path.v = null }
  _path.at = Date.now()
  return _path.v
}

const cscFound = () => ['Framework64', 'Framework'].some((f) =>
  existsSync(join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', f, 'v4.0.30319', 'csc.exe')))

function configCheck() {
  try {
    const { projects } = loadConfig()
    return { count: projects.length, missing: projects.filter((p) => !existsSync(p.repo)).map((p) => ({ id: p.id, repo: p.repo })), error: null }
  } catch (e) { return { count: 0, missing: [], error: e.message } }
}

/** 이 파일이 직접 읽는 것들 (작업·전원·계정은 상태 집계가 이미 읽은 것을 받는다) */
export function readyInputs() {
  const pathText = newProcessPath()
  return {
    node: { version: process.version, dir: dirname(process.execPath), onPath: nodeOnPath(pathText) },
    exe: { runhidden: existsSync(join(RS_HOME, 'runhidden.exe')), start: existsSync(join(RS_HOME, 'start.exe')), csc: cscFound() },
    cli: { installed: claudeInstalls().length > 0 },
    config: configCheck(),
  }
}

/** 상태 집계(fullStatus)가 부른다 — 이미 읽은 작업·전원·계정을 그대로 쓴다 */
export const readyState = (d) => readyVerdict({
  ...readyInputs(), tasks: d.tasks, pc: d.pc, account: d.account, resumeOn: d.totals?.restartOn || 0,
})

/**
 * «다시 확인». 판정이 쓰는 캐시를 **지금** 새로 채운다 — 판정은 하지 않는다.
 * 🔴 판정을 여기서 따로 하지 않는 이유: 이어지는 상태 조회(readyState)가 같은 캐시로 같은 판정을
 *   한다. 여기서 따로 판정해 돌려주면 판정이 두 길이 되고, 3초 뒤 폴링이 다른 말을 할 수 있다.
 * 🔴 예약·로그인은 막지 않고 기다린다(수 초씩 걸린다). 전원은 0.5초라 그대로 읽는다(pc.mjs).
 */
export async function refreshReady() {
  _path.v = undefined
  await Promise.all([refreshTasks(), refreshAccount()])
  pcState({ force: true })
}

/**
 * «이 PC 준비하기». 서버의 POST /api/ready 가 부른다.
 * 🔴 실행 직전에 **다시 판정**한다 — 화면은 몇 초 묵어 있을 수 있다. 화면이 보낸 목록을 믿지 않는다.
 */
export async function applyReady(run = runStep) {
  await refreshTasks()
  _path.v = undefined
  const before = readyVerdict({ ...readyInputs(), tasks: taskState(), pc: pcState({ force: true }), account: account() })
  const steps = applySteps(before)
  if (!steps.length) return { ok: true, nothing: true, results: [], before: before.level }
  const r = await runSteps(steps, run)
  // 바꿨으면 캐시가 거짓말을 한다 — 전원은 버리고, 작업은 막지 않고 새로 읽는다
  clearPcCache()
  _path.v = undefined
  await refreshTasks()
  return { ...r, before: before.level }
}
