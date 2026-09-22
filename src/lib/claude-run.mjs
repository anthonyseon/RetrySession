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

/**
 * 🔴 셸(cmd.exe)을 거치지 않는다.
 *   claudeBin() 이 네이티브 `claude.exe` 를 돌려주므로 인자를 배열로 그대로 넘긴다.
 *   그 덕에: 콘솔 창이 뜨지 않고, 인자를 직접 인용할 필요가 없고(코드페이지로 한글이
 *   깨지지 않는다), 프로세스 트리가 한 겹 얕아 종료가 단순하다.
 *   설치 형태가 달라 .cmd 로 물러설 때만 셸을 쓴다.
 */
export function runClaude({ sessionId, cwd, prompt, cfg, addDirs }) {
  return new Promise((resolve) => {
    const startedText = Date.now()
    const args = ['--resume', sessionId, '-p', '--output-format', 'json',
      '--permission-mode', cfg.permissionMode || 'acceptEdits']
    for (const d of addDirs || []) args.push('--add-dir', d)

    const exe = claudeBin(cfg.claudeBin)
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
    }, (cfg.timeoutMin ?? 30) * 60_000)

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

