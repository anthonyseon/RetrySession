/**
 * resume.mjs — 세션 바깥에서 **실제로 일을 재개시킨다.**
 *
 * 이 파일이 메우는 비대칭
 *   하트비트는 "어디서 멈췄는지"를 바깥에 적어두는 장치일 뿐이다. 기록은 남지만 일은
 *   재개되지 않는다. 원본 계획에서는 재개를 세션 안 예약(cron)이나 사람이 해야 했고,
 *   세션이 닫히면 둘 다 멈췄다 — 그것이 유일하게 남은 정지 요인이었다.
 *   여기서는 OS 작업 스케줄러가 `claude --resume <sessionId> -p` 를 띄운다.
 *
 * 🔴 왜 --resume 인가 (새 세션을 만들지 않는다)
 *   실측: `claude --resume <id> -p` 는 헤드리스로 돌고 **문맥을 유지한다**(직전 요청을
 *   정확히 회상했고, 응답의 session_id 가 재개한 id 와 같았다 — 갈라지지 않는다).
 *   새 `claude -p` 로 띄우면 그 세션이 무엇을 하던 중인지 처음부터 설명해야 하고,
 *   캐시도 새로 잡혀 더 비싸다.
 *
 * 🔴 인증은 VS Code 에 로그인된 계정을 쓴다. API 키를 쓰지 않는다 (lib/cli.mjs 의 계정환경).
 *
 * 🔴 사람이 보고 있지 않은 실행이다. 가드를 먼저 통과해야 한다 — 싼 것부터 순서대로:
 *   ① 등록  ② 조용한 시간  ③ 세션이 실행 중인가(pid)  ④ 최근 활동
 *   ⑤ 재개 지점이 있나(추적기·재개지시)  ⑥ 예산  ⑦ 락
 *   하나라도 막히면 이유를 로그에 적고 exit 0 으로 끝낸다 — 스케줄러가 실패로 보지 않게.
 *
 * 사용법
 *   node src/resume.mjs              가드 통과 시 재개 (스케줄러가 부르는 것)
 *   node src/resume.mjs --dry-run    가드만 판정하고 띄우지 않는다 (지시문도 보여준다)
 *   node src/resume.mjs --status     예산·마지막 실행 상태
 *   node src/resume.mjs --rearm      회로 차단·연속실패 해제
 *   node src/resume.mjs --force      조용한시간·활동·예산 무시 (실행 중 확인과 락은 지킨다)
 */
import { appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { localStamp } from './lib/stamp.mjs'
import { readTracker, resumePrompt } from './lib/tracker.mjs'
import {
  loadRunState, saveRunState, budgetVerdict, recordRun, rearm,
  acquireLock, releaseLock, quietNow,
} from './lib/guard.mjs'
import { loadTargets, statePaths, resolveRepo, trackerPath } from './lib/targets.mjs'
import { runningSessions, account, claudeBin, 셸필요, 계정환경, 살아있나 } from './lib/cli.mjs'
import { scanSessions } from './lib/sessions.mjs'
import { 단일실행 } from './lib/single.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null }
const DRY = flag('--dry-run'), FORCE = flag('--force')

const 로그 = (P, line) => { try { appendFileSync(P.재개로그, line + '\n') } catch { /* 로그 실패로 재개를 막지 않는다 */ } }

function 대상들() {
  const t = loadTargets()
  const one = opt('--session')
  let list = Object.entries(t.targets).map(([id, v]) => ({ sessionId: id, ...v }))
  if (one) list = list.filter((x) => x.sessionId === one || x.sessionId.startsWith(one))
  else list = list.filter((x) => x.재시작)
  return list
}

/* ── 지시문 ──────────────────────────────────────────────────── */

/**
 * 재개 지시문. 세션을 이어받으므로 문맥 설명은 필요 없다 — **무엇을 계속할지와
 * 무인 실행의 한계**만 말한다.
 */
function 지시문(대상, project) {
  if (대상.재개지시) {
    return [
      '이 실행은 OS 작업 스케줄러가 띄운 것이고 사람이 보고 있지 않다. 아래 지시를 이어서 수행하라.',
      '',
      대상.재개지시,
      '',
      ...안전규칙(),
    ].join('\n')
  }

  const tp = trackerPath(project)
  if (tp) return resumePrompt(readTracker(tp), project)

  return [
    '이 실행은 OS 작업 스케줄러가 띄운 것이고 사람이 보고 있지 않다.',
    '이 세션에서 하던 작업을 이어서 진행하라.',
    '',
    '1. 먼저 이 대화에서 무엇을 하던 중이었는지 확인하고, 마지막으로 끝내지 못한 일 하나를 고른다.',
    '2. 그 하나만 끝낸다. 새 작업을 시작하지 않는다.',
    ...안전규칙(),
  ].join('\n')
}

const 안전규칙 = () => ([
  '',
  '🔴 무인 실행 규칙',
  '- 판단이 갈리는 지점에서는 멈춘다. 무엇이 막혔는지 적고 끝낸다 — 추측으로 진행하지 않는다.',
  '- 되돌리기 어려운 작업은 하지 않는다: force push · 브랜치 삭제 · 파일 대량 삭제 · 외부 전송·발행.',
  '- 끝낼 때 무엇을 했는지 한 문단으로 요약한다. 그 요약이 재개 로그에 남는다.',
])

/* ── 가드 ────────────────────────────────────────────────────── */

function 판정(대상, ctx) {
  const P = statePaths(대상.sessionId)
  const 짝cwd = 대상.주작업cwd || 대상.실행cwd
  const { project } = 짝cwd ? resolveRepo(짝cwd) : { project: null }
  const cfg = project?.재개 || {}
  const state = loadRunState(P.재개상태)
  const stop = (why) => ({ go: false, why, P, project, state })

  if (!대상.재시작 && !FORCE) return stop('재시작이 꺼져 있다 (UI 에서 켜라)')
  if (!project) return stop('작업 디렉터리를 알 수 없다 — 재개를 띄울 자리가 없다')

  if (!FORCE) {
    const qn = quietNow(cfg.조용한시간)
    if (qn.quiet) return stop(qn.why)
  }

  /**
   * 🔴 실행 중 확인은 FORCE 로도 건너뛰지 않는다.
   *   사람이 켜둔 세션을 --resume 으로 동시에 밀면 같은 대화에 두 주체가 쓴다.
   *   pid 로 보는 것이 정확하다 — mtime 추측이 아니다.
   */
  const run = ctx.실행중맵.get(대상.sessionId)
  if (run && 살아있나(run.pid)) {
    return stop(`세션이 실행 중이다 (pid ${run.pid}) — 사람이 쓰는 중이므로 건드리지 않는다`)
  }

  const s = ctx.세션맵.get(대상.sessionId)
  if (!s) return stop('세션을 찾을 수 없다 — 트랜스크립트가 정리된 것으로 보인다')

  if (!FORCE) {
    const 한계 = cfg.세션활성분 ?? 10
    if (s.활성분 !== null && s.활성분 < 한계) {
      return stop(`방금까지 활동이 있었다 (${s.활성분}분 전, 한계 ${한계}분) — 아직 사람이 붙어 있을 수 있다`)
    }
  }

  /* 재개 지점이 있나 */
  const tp = trackerPath(project)
  if (tp) {
    const t = readTracker(tp)
    if (t.error) return stop(`추적기를 읽을 수 없다 — ${t.error}`)
    if (t.전부완료) return stop(`할 일이 없다 (${t.완료표기} 전부 done)`)
    if (!t.doing && !t.다음todo) return stop('추적기에 doing 도 todo 도 없다 — 재개 지점을 말해주지 않는다')
  } else if (!대상.재개지시) {
    return stop('추적기도 재개지시도 없다 — 무엇을 이어서 할지 정해지지 않았다 (UI 에서 재개지시를 넣어라)')
  }

  if (!FORCE) {
    const b = budgetVerdict(state, cfg)
    if (!b.ok) return stop(b.why)
  }

  const 지점 = tp ? (() => { const t = readTracker(tp); return t.doing ? `doing ${t.doing.id}` : `todo ${t.다음todo.id}` })() : '재개지시'
  return { go: true, why: `재개 지점 ${지점}`, P, project, state }
}

/* ── claude 실행 ─────────────────────────────────────────────── */

/**
 * 🔴 셸(cmd.exe)을 거치지 않는다.
 *   claudeBin() 이 네이티브 `claude.exe` 를 돌려주므로 인자를 배열로 그대로 넘긴다.
 *   그 덕에: 콘솔 창이 뜨지 않고, 인자를 직접 인용할 필요가 없고(코드페이지로 한글이
 *   깨지지 않는다), 프로세스 트리가 한 겹 얕아 종료가 단순하다.
 *   설치 형태가 달라 .cmd 로 물러설 때만 셸을 쓴다.
 */
function runClaude({ sessionId, cwd, prompt, cfg, addDirs }) {
  return new Promise((resolve) => {
    const 시작 = Date.now()
    const args = ['--resume', sessionId, '-p', '--output-format', 'json',
      '--permission-mode', cfg.권한모드 || 'acceptEdits']
    for (const d of addDirs || []) args.push('--add-dir', d)

    const exe = claudeBin(cfg.claudeBin)
    // 🔴 env 를 계정환경으로 준다 — API 키가 설정돼 있어도 로그인 계정이 이긴다
    const child = spawn(exe, args, {
      cwd, windowsHide: true, env: 계정환경(), shell: 셸필요(exe),
    })

    let stdout = '', stderr = '', timedOut = false
    const CAP = 4_000_000
    child.stdout.on('data', (d) => { if (stdout.length < CAP) stdout += d.toString('utf8') })
    child.stderr.on('data', (d) => { if (stderr.length < CAP) stderr += d.toString('utf8') })

    // 🔴 이 CLI 버전에 --max-turns 가 없다(실측). 폭주는 벽시계 타임아웃으로만 막는다.
    const timer = setTimeout(() => {
      timedOut = true
      // 자식을 또 띄울 수 있으므로 트리째 끊는다. taskkill 은 셸 없이 부른다.
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch { /* 이미 죽었으면 됐다 */ }
      try { child.kill() } catch { /* 위와 같다 */ }
    }, (cfg.타임아웃분 ?? 30) * 60_000)

    const 끝 = (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut, 소요초: Math.round((Date.now() - 시작) / 1000), exe })
    }
    child.on('error', (e) => { stderr += '\n' + e.message; 끝(-1) })
    child.on('close', 끝)

    try { child.stdin.write(prompt, 'utf8'); child.stdin.end() } catch (e) { stderr += `\nstdin 실패: ${e.message}` }
  })
}

function parseResult(stdout) {
  try {
    const j = JSON.parse(stdout)
    return {
      ok: !j.is_error, 요약: j.result || '',
      비용USD: typeof j.total_cost_usd === 'number' ? +j.total_cost_usd.toFixed(4) : 0,
      턴수: j.num_turns ?? null, 세션id: j.session_id ?? null,
      권한거부: Array.isArray(j.permission_denials) ? j.permission_denials.length : 0,
    }
  } catch {
    return { ok: false, 요약: String(stdout).slice(0, 1500), 비용USD: 0, 턴수: null, 세션id: null, 권한거부: 0, 파싱실패: true }
  }
}

/* ── 부속 명령 ───────────────────────────────────────────────── */

if (flag('--status')) {
  const acct = account()
  console.log(`계정: ${acct.email || '?'} · ${acct.subscriptionType || '?'}${acct.구독제 ? ' (구독 — 정가 환산은 청구액이 아니다)' : ''}`)
  const list = Object.entries(loadTargets().targets)
  if (!list.length) console.log('대상이 없다.')
  for (const [id, v] of list) {
    const P = statePaths(id)
    const 짝 = v.주작업cwd || v.실행cwd
    const { project } = 짝 ? resolveRepo(짝) : { project: null }
    const st = loadRunState(P.재개상태)
    const b = project ? budgetVerdict(st, project.재개) : { 오늘실행: '?', 오늘비용: '?', ok: false, why: '저장소 미해결' }
    console.log(`── ${id.slice(0, 8)} ${v.제목 ? `· ${v.제목.slice(0, 40)}` : ''}`)
    console.log(`   재시작 ${v.재시작 ? 'O' : 'X'} · 감시 ${v.감시 ? 'O' : 'X'} · 권한 ${project?.재개.권한모드 || '-'}`)
    console.log(`   오늘 ${b.오늘실행}/${project?.재개.하루최대회 ?? '-'}회 · $${b.오늘비용}/$${project?.재개.하루최대비용USD ?? '-'}`)
    console.log(`   연속실패 ${st.연속실패 || 0}/${project?.재개.연속실패한계 ?? '-'} · 차단 ${st.차단 ? `🔴 ${st.차단.이유}` : '없음'}`)
    console.log(`   마지막 ${st.마지막실행 ? `${st.마지막실행.at} · ${st.마지막실행.결과} · ${st.마지막실행.소요초}초 · $${st.마지막실행.비용USD ?? 0}` : '없음'}`)
  }
  process.exit(0)
}

if (flag('--rearm')) {
  for (const 대상 of 대상들().length ? 대상들() : Object.entries(loadTargets().targets).map(([id, v]) => ({ sessionId: id, ...v }))) {
    const P = statePaths(대상.sessionId)
    saveRunState(P.재개상태, rearm(loadRunState(P.재개상태)))
    로그(P, `${localStamp()} · REARM · 회로 차단·연속실패 해제 (사람이 실행)`)
    console.log(`✅ ${대상.sessionId.slice(0, 8)} — 회로 차단 해제`)
  }
  process.exit(0)
}

/* ── 본 실행 ─────────────────────────────────────────────────── */

/**
 * 🔴 재시작은 프로세스 단위로도 하나만 돈다.
 *   세션별 락은 같은 세션을 두 번 미는 것만 막는다. 프로세스가 둘이면 서로 다른
 *   세션을 동시에 밀어 하루 예산을 두 배로 쓰고, 워킹트리가 겹치면 편집이 충돌한다.
 *   한 회차는 최대 타임아웃(기본 30분)이므로 90분을 넘겼다면 죽은 락으로 본다.
 */
단일실행('resume', { 낡음분: 90 })

const 목록 = 대상들()
if (!목록.length) {
  console.log(`재시작 ${localStamp()} — 대상이 없다. UI 에서 세션을 골라 재시작을 켜라.`)
  process.exit(0)
}

// 실행 중 목록과 세션 스캔은 한 번만
const run = runningSessions()
const scan = scanSessions()
const ctx = {
  실행중맵: new Map(run.sessions.map((s) => [s.sessionId, s])),
  세션맵: new Map(scan.sessions.map((s) => [s.sessionId, s])),
}

let 종료코드 = 0

for (const 대상 of 목록) {
  const v = 판정(대상, ctx)
  const 짧은 = 대상.sessionId.slice(0, 8)

  if (!v.go) {
    로그(v.P, `${localStamp()} · SKIP · ${v.why}`)
    console.log(`⛔ ${짧은} 건너뜀 — ${v.why}`)
    continue
  }

  const prompt = 지시문(대상, v.project)

  if (DRY) {
    console.log(`✅ ${짧은} 재개 가능 — ${v.why}`)
    console.log('─── 넘길 지시문 ───')
    console.log(prompt)
    console.log('───────────────────')
    continue
  }

  const cfg = v.project.재개
  const lock = acquireLock(v.P.재개락, cfg.락낡음분 ?? 60)
  if (!lock.ok) {
    로그(v.P, `${localStamp()} · SKIP · ${lock.why}`)
    console.log(`⛔ ${짧은} 건너뜀 — ${lock.why}`)
    continue
  }

  try {
    const cwd = 대상.실행cwd || v.project.repo
    로그(v.P, [
      '', '═'.repeat(70),
      `${localStamp()} · RUN 시작 · ${v.why}`,
      `  --resume ${대상.sessionId} · 권한 ${cfg.권한모드} · 타임아웃 ${cfg.타임아웃분}분`,
      `  cwd ${cwd}`,
    ].join('\n'))
    console.log(`▶ ${짧은} 재개 — ${v.why}`)

    const r = await runClaude({
      sessionId: 대상.sessionId, cwd, prompt, cfg, addDirs: cfg.addDirs,
    })
    const p = parseResult(r.stdout)
    const 결과 = r.timedOut ? 'timeout' : (r.code === 0 && p.ok) ? 'ok' : 'fail'

    const next = recordRun(loadRunState(v.P.재개상태), {
      결과, 요약: p.요약, 소요초: r.소요초, 비용USD: p.비용USD,
      턴수: p.턴수, 세션id: p.세션id, 권한거부: p.권한거부, exit: r.code,
    }, cfg)
    saveRunState(v.P.재개상태, next)

    로그(v.P, [
      `${localStamp()} · RUN 끝 · ${결과} · ${r.소요초}초 · $${p.비용USD} · 턴 ${p.턴수 ?? '?'} · exit ${r.code}` +
        (p.권한거부 ? ` · 권한거부 ${p.권한거부}건` : '') +
        (r.timedOut ? ' · 🔴 타임아웃으로 강제 종료' : ''),
      // 세션이 갈라졌는지 확인한다 — 같아야 정상이다
      p.세션id && p.세션id !== 대상.sessionId ? `  ⚠ 세션이 갈라졌다: ${p.세션id}` : '',
      '  ── 요약 ──',
      (p.요약 || '(없음)').split('\n').map((l) => '  ' + l).join('\n'),
      r.stderr.trim() ? '  ── stderr ──\n' + r.stderr.trim().split('\n').slice(-20).map((l) => '  ' + l).join('\n') : '',
      next.차단 ? `  🔴 연속 ${next.연속실패}회 실패로 회로 차단됨 — 고친 뒤 --rearm` : '',
    ].filter(Boolean).join('\n'))

    console.log(`${결과 === 'ok' ? '✅' : '✖'} ${짧은} — ${결과} · ${r.소요초}초 · $${p.비용USD}`)
    if (결과 !== 'ok') 종료코드 = 1
  } finally {
    releaseLock(v.P.재개락)
  }
}

process.exit(종료코드)
