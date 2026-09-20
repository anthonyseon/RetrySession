/**
 * procs.mjs — 살아 있는 claude.exe 를 직접 열거한다. 네 번째 출처.
 *
 * 왜 필요한가 (실측)
 *   `claude agents --json` 은 세션 2개를 보고했는데, 실제로 돌고 있는 claude.exe 는
 *   **4개**였다. 나머지 둘은 `--claude-in-chrome-mcp` 보조 프로세스라 세션이 아닌 게
 *   맞았지만, **CLI 만 믿었으면 그 존재조차 몰랐다.**
 *   "목록에 없다"는 물음에 답하려면 무엇이 돌고 있는지 먼저 다 보여야 한다.
 *   CLI 가 모르는 것이 있어도 프로세스는 거짓말하지 않는다.
 *
 * 또 하나 드러난 사실: VS Code 는 npm 판이 아니라 **확장에 번들된 바이너리**를 쓴다.
 *   c:\Users\<u>\.vscode\extensions\anthropic.claude-code-<버전>-win32-x64\
 *     resources\native-binary\claude.exe
 *   버전도 다를 수 있다(실측: 확장 2.1.263 vs npm 2.1.246). 어느 쪽이 도는지 보여준다.
 *
 * 🔴 명령행에는 비밀이 없지만 길다. 필요한 조각만 뽑아 담는다.
 */
import { execFileSync } from 'node:child_process'
import { 경로키 } from './config.mjs'
import { localStamp } from './stamp.mjs'

const _cache = new Map()

/** CIM 한 번 — 프로세스 목록은 PowerShell 로 얻는 게 가장 확실하다 */
function query() {
  // 속성 이름이 로케일과 무관하게 영어인 경로를 쓴다(scheduler.mjs 와 같은 이유).
  const ps = [
    `$ErrorActionPreference='SilentlyContinue';`,
    `$out = Get-CimInstance Win32_Process -Filter "Name='claude.exe'" | ForEach-Object {`,
    `  [pscustomobject]@{`,
    `    pid=$_.ProcessId; ppid=$_.ParentProcessId;`,
    `    started=$(if($_.CreationDate){$_.CreationDate.ToString('yyyy-MM-dd HH:mm:ss')}else{$null});`,
    `    cmd=$_.CommandLine`,
    `  }`,
    `};`,
    `ConvertTo-Json -InputObject @($out) -Compress -Depth 3`,
  ].join(' ')

  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
    })
    const j = JSON.parse(out)
    return { ok: true, rows: Array.isArray(j) ? j : [j], 오류: null }
  } catch (e) {
    return { ok: false, rows: [], 오류: (e.stderr || e.message || '').toString().slice(0, 300) || '조회 실패' }
  }
}

/** 명령행에서 필요한 조각만. 순수 함수라 시험할 수 있다 */
export function 명령행해석(cmd) {
  const c = String(cmd || '')

  const resume = /--resume[= ]([0-9a-fA-F-]{36})/.exec(c)?.[1] || null
  const sessionId = /--session-id[= ]([0-9a-fA-F-]{36})/.exec(c)?.[1] || null

  const addDirs = []
  const re = /--add-dir[= ]("([^"]+)"|(\S+))/g
  let m
  while ((m = re.exec(c))) addDirs.push(경로키(m[2] || m[3]))

  const 확장 = /[\\/]\.vscode[\\/]extensions[\\/]/i.test(c)
  const 확장버전 = /anthropic\.claude-code-([\d.]+)-/i.exec(c)?.[1] || null

  /**
   * 세션인가 보조 프로세스인가.
   * 실측: 보조는 `--claude-in-chrome-mcp` 하나만 붙어 명령행이 짧다(137자).
   * 세션은 `--output-format stream-json` 을 달고 길다(671~713자).
   */
  const mcp보조 = c.includes('--claude-in-chrome-mcp')
  const 세션형 = !mcp보조 && (c.includes('stream-json') || !!resume || !!sessionId)

  return {
    종류: mcp보조 ? 'mcp보조' : (세션형 ? '세션' : '기타'),
    resume, sessionId: resume || sessionId,
    addDirs,
    출처: 확장 ? 'VS Code 확장' : 'npm',
    확장버전,
    권한모드: /--permission-mode[= ](\S+)/.exec(c)?.[1] || null,
    위험권한: c.includes('--dangerously-skip-permissions') || c.includes('--allow-dangerously-skip-permissions'),
    길이: c.length,
  }
}

/**
 * 지금 도는 claude.exe 전부.
 * @returns {{ok:boolean, 목록:Array, 세션수:number, 보조수:number, 오류:string|null}}
 */
export function claudeProcesses({ ttlMs = 10000 } = {}) {
  const hit = _cache.get('p')
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.v, 캐시됨: true }

  const r = query()
  const 목록 = r.rows.filter(Boolean).map((x) => {
    const p = 명령행해석(x.cmd)
    return {
      pid: x.pid, ppid: x.ppid,
      시작: x.started || null,
      ...p,
    }
  }).sort((a, b) => (a.종류 === '세션' ? -1 : 1) - (b.종류 === '세션' ? -1 : 1) || a.pid - b.pid)

  const v = {
    ok: r.ok, 오류: r.오류, 목록,
    세션수: 목록.filter((x) => x.종류 === '세션').length,
    보조수: 목록.filter((x) => x.종류 !== '세션').length,
    조회시각: localStamp(),
  }
  _cache.set('p', { at: Date.now(), v })
  return { ...v, 캐시됨: false }
}

export function 캐시비우기() { _cache.clear() }
