/**
 * claude-run.mjs — `claude --resume` 을 **띄우고 결과를 읽는다.** 판정은 하지 않는다.
 *
 * 🔴 왜 resume.mjs 에서 떼어냈나
 *   resume.mjs 가 468줄이 되어 400줄 규칙을 넘겼다. 자를 자리는 여기가 맞다 —
 *   위쪽(가드)은 "띄워도 되는가"를 정하고, 여기는 "띄운다"만 한다. 섞여 있으면
 *   가드를 고칠 때마다 프로세스 실행 코드를 함께 읽어야 한다.
 */
import { spawn } from 'node:child_process'
import { claudeBin, needsShell, accountEnv } from './cli.mjs'
import { pathKey } from './config.mjs'

/**
 * **어디서 띄우고, 어디까지 쓸 수 있게 하나.** 순수 함수.
 *
 * 🔴 실측 결함 (2026-09-28) — 첫 성공 재개가 **아무것도 남기지 못했다.**
 *   `RUN 끝 · ok · 370초 · $18.271 · 턴 22 · 권한거부 11건` 인데 디스크에 변경 0건이었다.
 *   거부 사유를 읽어 보니 권한 모드가 아니라 **경로**였다:
 *     `Claude requested permissions to write to …\Description\_plan\_resume\07-실행추적.json`
 *   그때의 값: cwd = `…\EasyAI.Platform`(등록부의 runCwd) · --add-dir = `…\EasyAI.Platform`
 *   (설정의 addDirs) · 정작 추적기와 대상 파일은 `…\Description` 아래.
 *   **같은 폴더를 두 번 허용하고, 일할 폴더는 한 번도 허용하지 않았다.**
 *   `acceptEdits` 는 허용된 작업 폴더 안의 편집만 자동 승인하므로 전부 승인 대기가 됐다.
 *
 * 🔴 그래서 뿌리를 **추적기를 소유한 저장소**로 맞춘다.
 *   지시문이 말하는 추적기 경로가 `project.repo` 기준이므로, 거기서 띄우지 않으면
 *   "이 파일을 고쳐라"와 "그 파일을 못 고친다"가 같은 실행 안에서 동시에 참이 된다.
 *
 * 🔴 그러면서 세션이 실제로 일해 온 폴더를 잃지 않는다 — `runCwd`·`mainCwd` 를
 *   `--add-dir` 로 함께 넘긴다. 이 둘은 그 세션의 트랜스크립트에서 관측된 값이고,
 *   무인 재개가 쓸 수 있어야 하는 곳은 정확히 **그 세션이 쓰고 있던 곳**이다.
 *   설정의 `addDirs` 도 그대로 더한다(사람이 일부러 넓혀 둔 것이다).
 *   cwd 와 같은 폴더는 버린다 — 실측에서 본 그 쓸모없는 중복이 그것이다.
 *
 * @returns {{cwd:string, addDirs:string[]}}
 */
export function launchRoots(target, project) {
  const t = target || {}, p = project || {}
  const cwd = p.repo || t.runCwd || t.mainCwd || null
  /**
   * 🔴 같은 폴더인지 볼 때는 **대소문자를 무시한다.** `pathKey` 는 드라이브 문자만
   *   대문자로 맞추고 나머지 대소문자는 그대로 두므로, Windows 에서 같은 폴더인
   *   `c:/repo/A` 와 `C:/REPO/a` 가 다른 키가 된다 — `isInside` 가 쓰는 방식과 같게 맞춘다.
   *   틀리면 같은 폴더를 두 번 넘기게 되고, 그것이 이번 사고의 겉모습이었다.
   */
  const key = (x) => pathKey(x).toLowerCase()
  const seen = new Set(cwd ? [key(cwd)] : [])
  const addDirs = []
  for (const d of [t.runCwd, t.mainCwd, ...(p.resume?.addDirs || [])]) {
    if (!d) continue
    const k = key(d)
    if (seen.has(k)) continue
    seen.add(k)
    addDirs.push(d)
  }
  return { cwd, addDirs }
}

/**
 * 🔴 셸(cmd.exe)을 거치지 않는다.
 *   claudeBin() 이 네이티브 `claude.exe` 를 돌려주므로 인자를 배열로 그대로 넘긴다.
 *   그 덕에: 콘솔 창이 뜨지 않고, 인자를 직접 인용할 필요가 없고(코드페이지로 한글이
 *   깨지지 않는다), 프로세스 트리가 한 겹 얕아 종료가 단순하다.
 *   설치 형태가 달라 .cmd 로 물러설 때만 셸을 쓴다.
 */
export function runClaude({ sessionId, cwd, prompt, cfg, addDirs, exe: given = null }) {
  return new Promise((resolve) => {
    const startedText = Date.now()
    const args = ['--resume', sessionId, '-p', '--output-format', 'json',
      '--permission-mode', cfg.permissionMode || 'acceptEdits']
    /**
     * 🔴 **무인 실행은 `claude --dangerously-skip-permissions` 와 같은 권한으로 돈다**
     *   (사용자 결정 2026-09-28). `--permission-mode bypassPermissions` 만으로는 부족하다 —
     *   그 모드에서도 헤드리스 실행이 승인 요청을 만들면 사람이 없어 곧 거부가 된다.
     *
     *   왜 그렇게 정했나 (실측): `acceptEdits` 로 두 회차를 돌렸더니 둘 다 결과가 없었다.
     *     13:48 · ok · $18.271 · 권한거부 11건 → 디스크 변경 0건 (Write·Edit·git·node)
     *     15:11 · ok · $15.814 · 권한거부  7건 → 디스크 변경 0건 (node 스크립트·리다이렉션)
     *   그 저장소는 편집을 자기 `.mjs` 스크립트로만 하고 게이트 15종을 돌리도록 규약이
     *   세워져 있어서, node 를 못 쓰면 **일을 시작할 수조차 없다.** 돈만 쓰고 끝났다.
     *
     *   🔴 대가를 분명히 적어 둔다: 이 모드에서 무인 재개는 **무엇이든 실행할 수 있다.**
     *   그래서 남은 방어선은 넷이다 — 재개지시의 안전 규칙 두 줄(추측 금지·되돌리기 어려운
     *   작업 금지) · 하루 횟수 상한 · 회차 타임아웃 · "일하는 중이면 안 건드린다" 판정.
     *   되돌리려면 이 블록을 지우는 것이 아니라 설정의 permissionMode 를 내려라.
     */
    if ((cfg.permissionMode || '') === 'bypassPermissions') args.push('--dangerously-skip-permissions')
    for (const d of addDirs || []) args.push('--add-dir', d)

    /**
     * 🔴 부르는 쪽이 고른 것을 **그대로** 쓴다(로그에 적힌 그것이다). 넘기지 않으면 여기서
     *   고른다 — 그때도 버전으로 고른다(`claudeBin`). 두 곳에서 따로 고르면 로그가 거짓이 된다.
     */
    const exe = given || claudeBin(cfg.claudeBin)
    // 🔴 env 를 계정환경으로 준다 — API 키가 설정돼 있어도 로그인 계정이 이긴다
    const child = spawn(exe, args, {
      cwd, windowsHide: true, env: accountEnv(), shell: needsShell(exe),
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
    }, (cfg.timeoutMin ?? 60) * 60_000)

    const end = (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut, tookSec: Math.round((Date.now() - startedText) / 1000), exe })
    }
    child.on('error', (e) => { stderr += '\n' + e.message; end(-1) })
    child.on('close', end)

    try { child.stdin.write(prompt, 'utf8'); child.stdin.end() } catch (e) { stderr += `\nstdin 실패: ${e.message}` }
  })
}

export function parseResult(stdout) {
  try {
    const j = JSON.parse(stdout)
    return {
      ok: !j.is_error, summary: j.result || '',
      costUSD: typeof j.total_cost_usd === 'number' ? +j.total_cost_usd.toFixed(4) : 0,
      turns: j.num_turns ?? null, sid: j.session_id ?? null,
      permDenied: Array.isArray(j.permission_denials) ? j.permission_denials.length : 0,
    }
  } catch {
    return { ok: false, summary: String(stdout).slice(0, 1500), costUSD: 0, turns: null, sid: null, permDenied: 0, parseFailed: true }
  }
}

