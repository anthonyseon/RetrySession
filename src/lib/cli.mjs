/**
 * cli.mjs — Claude Code CLI 를 정보 출처로 쓴다.
 *
 * 왜 CLI 인가 (파일을 직접 읽는 것보다 이쪽이 먼저다)
 *   트랜스크립트(`~/.claude/projects/*.jsonl`)는 내부 구조라 예고 없이 바뀔 수 있다.
 *   CLI 는 공식 인터페이스다. 얻을 수 있는 것은 CLI 로 얻고, CLI 가 주지 않는 것만 파일에서 읽는다.
 *
 * 무엇을 어디서 (실측으로 확인한 경계)
 *   `claude agents --json`      → **실행 중** 세션: pid · cwd · kind · startedAt · sessionId · name
 *   `claude auth status --json` → 계정: loggedIn · email · orgName · subscriptionType · authMethod
 *   트랜스크립트                → 토큰·비용·제목·할당량 (CLI 에 해당 명령이 없다)
 *
 * 🔴 인증은 VS Code 에 로그인된 계정을 그대로 쓴다.
 *   API 키를 쓰지 않는다. 그래서 자식 프로세스의 환경에서 ANTHROPIC_API_KEY 계열을
 *   **비운다** — 설정돼 있으면 계정 프로필을 가려 다른 주체로 청구될 수 있다.
 */
import { execFileSync, execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * claude 실행 파일.
 *
 * 🔴 `claude.cmd` 가 아니라 `claude.exe` 를 쓴다.
 *   실측: npm 전역 설치의 `claude.cmd` 는 내용이 한 줄이고, 네이티브 실행 파일
 *   `node_modules/@anthropic-ai/claude-code/bin/claude.exe` 를 그대로 넘긴다.
 *   .cmd 를 쓰면 Node 가 셸(cmd.exe)을 거쳐야 하고, 그러면
 *     · 콘솔 창이 뜬다
 *     · 인자를 직접 인용해야 하고 코드페이지 때문에 한글이 깨진다
 *     · 프로세스 트리가 한 겹 깊어져 종료시 taskkill /T 가 필요하다
 *   .exe 를 직접 부르면 세 문제가 모두 없다 (shell:false · windowsHide:true).
 */
/**
 * 🔴 **설치본이 여럿이면 가장 새것을 쓴다** (실측 결함 2026-09-30).
 *
 *   무인 재개가 7초에 튕겼다:
 *     `API Error: 400 Claude Code 2.1.246 does not support this model;
 *      version 2.1.280 or newer is required. Run 'claude update' …`
 *   이 기계에는 설치본이 둘이었다 — npm 전역 **2.1.246**(2026-08-26)과 VS Code 확장이
 *   들고 있는 **2.1.283**. 사람의 세션은 전부 확장 것으로 돌고 있었고(실행 중 프로세스
 *   15개가 모두 그 경로), 우리만 낡은 npm 것을 부르고 있었다. 같은 계정·같은 세션을
 *   이어받는 도구가 **다른 버전으로** 붙으면 그 세션의 모델을 지원하지 못한다.
 *
 *   그래서 경로 순서로 고르지 않고 **버전으로** 고른다. 버전은 실행하지 않고 안다 —
 *   확장은 폴더 이름에(`anthropic.claude-code-2.1.283-win32-x64`), npm 은 package.json 에.
 *   (실행해서 알아내면 회차마다 프로세스를 띄우게 되고, 그 자체가 느려진다.)
 */
export function claudeInstalls() {
  const out = []
  const push = (path, version, from) => { if (existsSync(path)) out.push({ path, version, from }) }

  const appdata = process.env.APPDATA
  if (appdata) {
    const root = join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code')
    let v = null
    try { v = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || null } catch { v = null }
    push(join(root, 'bin', 'claude.exe'), v, 'npm')
  }

  /** VS Code 확장 번들 — 사람의 세션이 실제로 쓰는 것이다(실측) */
  const home = process.env.USERPROFILE || process.env.HOME
  for (const dir of ['.vscode', '.vscode-insiders', '.vscode-server']) {
    const exts = home ? join(home, dir, 'extensions') : null
    if (!exts || !existsSync(exts)) continue
    let names = []
    try { names = readdirSync(exts) } catch { names = [] }
    for (const name of names) {
      const m = /^anthropic\.claude-code-(\d+\.\d+\.\d+)(?:-|$)/.exec(name)
      if (!m) continue
      push(join(exts, name, 'resources', 'native-binary', 'claude.exe'), m[1], dir)
    }
  }
  return out
}

/** `2.1.283` > `2.1.246` — 자리마다 숫자로 견준다(문자열 비교는 `2.1.9 > 2.1.10` 이 된다) */
export function newerVersion(a, b) {
  const p = (v) => String(v || '').split('.').map((x) => parseInt(x, 10) || 0)
  const [x, y] = [p(a), p(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? a : b
  }
  return a
}

/**
 * 고른 실행 파일과 **그 버전**. 🔴 버전은 실행하지 않고 안다(설치본 목록에서 찾는다) —
 *   회차마다 `--version` 을 띄우면 그 자체가 비용이고, 로그 한 줄 때문에 그럴 이유가 없다.
 *
 * 왜 필요한가 (실측 결함 2026-09-30): 재개 로그에 **어느 CLI 로 띄웠는지** 적히지 않아서,
 *   `400 … does not support this model` 이 났을 때 프로세스 목록을 뒤지고 바이너리를 뜯어야
 *   원인(설치본이 둘 · 낡은 쪽으로 띄움)에 닿았다. 로그가 스스로 증거가 되게 한다.
 */
export function binInfo(override = null) {
  const path = claudeBin(override)
  const hit = claudeInstalls().find((x) => x.path === path)
  return { path, version: hit?.version || null, from: hit?.from || (override ? 'override' : 'PATH') }
}

export function claudeBin(override = null) {
  if (override) return override
  const list = claudeInstalls()
  /**
   * 🔴 버전을 **아는 것부터** 고른다. 모르는 설치본(package.json 이 깨진 경우)을 «최신» 으로
   *   대접하면 이 결함이 조용히 돌아온다 — 모르는 것을 좋은 쪽으로 읽지 않는다.
   */
  const known = list.filter((x) => x.version)
  if (known.length) {
    return known.reduce((best, x) => (newerVersion(x.version, best.version) === x.version && x.version !== best.version ? x : best)).path
  }
  if (list.length) return list[0].path
  const appdata = process.env.APPDATA
  // 설치 형태가 다르면 심으로 물러선다 (이때는 호출부가 셸을 써야 한다)
  if (appdata && existsSync(join(appdata, 'npm', 'claude.cmd'))) return join(appdata, 'npm', 'claude.cmd')
  return 'claude'
}

/** 셸을 거쳐야 하는 경로인가 — .exe 면 필요 없다 */
export const needsShell = (bin) => !/\.exe$/i.test(String(bin))

/**
 * 계정 프로필이 이기도록 정리한 환경.
 * 지금은 어느 키도 설정돼 있지 않지만(실측), 나중에 누가 설정해도 이 도구는 흔들리지 않아야 한다.
 */
export function accountEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_PROFILE
  return env
}

/**
 * CLI 를 한 번 부르고 JSON 으로 받는다. 실패는 던지지 않고 결과에 담는다.
 * 인자는 배열로 넘긴다 — 셸이 없으므로 인용도, 코드페이지 변환도 없다.
 */
function callJson(args, { timeout = 20000, bin = null } = {}) {
  const exe = claudeBin(bin)
  try {
    const out = execFileSync(exe, args, {
      encoding: 'utf8', timeout, windowsHide: true, env: accountEnv(),
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      shell: needsShell(exe), // .exe 면 false — 콘솔 창이 뜨지 않는다
    })
    return { ok: true, data: JSON.parse(out) }
  } catch (e) {
    return { ok: false, error: failureText(exe, e), data: null }
  }
}

/**
 * callJson 의 **막지 않는** 짝 — 같은 실행 파일·환경·실패 문구를 쓴다. 다른 것은 기다리는 방식뿐이다.
 *
 * 🔴 사람이 «다시 확인» 을 눌렀을 때 쓴다. execFileSync 는 CLI 가 늦으면 그만큼(최대 20초)
 *   서버의 한 스레드를 멈추고, 그동안 /api/ping 이 늦어 start.ps1·트레이가 서버를 죽었다고 읽는다.
 */
export function callJsonAsync(args, { timeout = 20000, bin = null } = {}) {
  const exe = claudeBin(bin)
  return new Promise((resolve) => {
    execFile(exe, args, {
      encoding: 'utf8', timeout, windowsHide: true, env: accountEnv(),
      maxBuffer: 8 * 1024 * 1024, shell: needsShell(exe),
    }, (e, out, err) => {
      // execFile 은 종료 코드를 e.code 에 담는다 — failureText 가 읽는 모양(stderr·status)으로 맞춘다
      if (e) return resolve({ ok: false, error: failureText(exe, Object.assign(e, { stderr: err, status: typeof e.code === 'number' ? e.code : null })), data: null })
      try { resolve({ ok: true, data: JSON.parse(out) }) } catch (x) { resolve({ ok: false, error: failureText(exe, x), data: null }) }
    })
  })
}

/**
 * 실패 이유를 **읽을 수 있는 한 줄**로.
 *
 * 🔴 실측 (2026-09-21): 셸로 물러선 경로에서 claude 를 못 찾자 이렇게 찍혔다 —
 *     "'claude'��(��) ���� �Ǵ� �ܺ� ����, ..."
 *   Windows 가 cp949 로 낸 메시지를 UTF-8 로 읽어 깨진 것이다. 이 문자열은
 *   재개 로그에 그대로 남고, 재개가 왜 멈췄는지 보러 온 사람이 읽을 수 없다.
 *   깨진 글자를 옮기느니 **우리가 아는 사실**을 적는다. 이 도구는 고장 났을 때
 *   읽히려고 있는 것이다.
 */
export function failureText(exe, e) {
  const raw = (e.stderr || e.message || String(e)).toString()
  const broken2 = raw.includes('�')   // 디코딩이 어긋났다는 확실한 표시
  if (broken2 || e.code === 'ENOENT') {
    return `claude CLI 를 실행할 수 없다 (${exe}) — 설치와 경로를 확인하라` +
      (e.status != null ? ` [exit ${e.status}]` : '')
  }
  return raw.slice(0, 500)
}

/* ── TTL 캐시 ────────────────────────────────────────────────── */
/**
 * UI 가 몇 초마다 물어보는데 그때마다 프로세스를 띄우면 느리고 시끄럽다.
 * 짧은 TTL 로 캐시한다 — 실행 중 세션 목록은 몇 초 낡아도 무해하다.
 */
const _cache = new Map()
function cached(key, ttlMs, fn) {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.v, cached: true, ageMs: Date.now() - hit.at }
  const v = fn()
  _cache.set(key, { at: Date.now(), v })
  return { ...v, cached: false, ageMs: 0 }
}

/**
 * 실행 중 세션. `--all` 이면 완료된 배경 세션도 포함한다.
 * @returns {{ok:boolean, sessions:Array, 오류:string|null}}
 */
export function runningSessions({ all = false, ttlMs = 5000 } = {}) {
  const key = `agents:${all}`
  const r = cached(key, ttlMs, () => callJson(all ? ['agents', '--json', '--all'] : ['agents', '--json']))
  const list = Array.isArray(r.data) ? r.data : []
  return {
    ok: r.ok,
    error: r.ok ? null : r.error,
    cached: r.cached,
    sessions: list.map((s) => ({
      sessionId: s.sessionId,
      pid: s.pid,
      cwd: s.cwd,
      kind: s.kind,
      name: s.name,
      startedAtEpoch: s.startedAt,
      // 프로세스가 실제로 살아있는지 한 번 더 본다 — 목록이 낡아 있을 수 있다
      alive: isAlive(s.pid),
    })),
  }
}

/** pid 가 살아있나. 신호 0 은 아무것도 보내지 않고 존재만 확인한다 */
export function isAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * 로그인 계정. 🔴 subscriptionType 이 'max' 같은 구독이면 토큰 정가 환산액은
 * **청구액이 아니다** — 화면에 그대로 "청구"라고 쓰면 사람을 오해시킨다.
 */
export function account({ ttlMs = 60000 } = {}) {
  const r = cached('auth', ttlMs, () => callJson(['auth', 'status', '--json']))
  const d = r.data || {}
  return {
    ok: r.ok && d.loggedIn === true,
    error: r.ok ? null : r.error,
    cached: r.cached,
    loggedIn: !!d.loggedIn,
    email: d.email || null,
    orgName: d.orgName || null,
    orgId: d.orgId || null,
    authMethod: d.authMethod || null,
    apiProvider: d.apiProvider || null,
    subscriptionType: d.subscriptionType || null,
    // 구독이면 정가 환산은 참고값이다
    isSubscription: !!d.subscriptionType && d.subscriptionType !== 'api',
  }
}

/**
 * 로그인을 **지금** 다시 읽어 캐시를 갈아 끼운다 — 막지 않는다.
 * 🔴 따로 들고 있지 않고 `account()` 의 캐시에 넣는다. 그래야 이어지는 상태 조회(3초 폴링)가
 *   새 값을 쓴다 — 따로 들면 «다시 확인» 직후 화면이 옛 값으로 되돌아간다.
 */
export async function refreshAccount() {
  _cache.set('auth', { at: Date.now(), v: await callJsonAsync(['auth', 'status', '--json']) })
  return account()
}

/**
 * `/usage` — Claude 가 스스로 말하는 **사용량 상세**.
 *
 * 🔴 왜 이것을 쓰나 (실측 2026-09-28)
 *   `claude --help` 에는 `usage` **하위 명령이 없다.** 하지만 세션 안의 슬래시 명령
 *   `/usage` 는 헤드리스에서도 돈다 — `claude -p /usage --output-format json` 을 재 보니
 *   `total_cost_usd: 0 · num_turns: 0 · duration_api_ms: 0` 이었다. **모델을 호출하지 않고
 *   로컬에서 답한다** — 그래서 공짜고, 화면의 `갱신` 이 눌릴 때마다 불러도 된다.
 *
 *   주는 것: 구독 사용 여부 · 최근 24시간·7일의 요청 수·세션 수 · 어떤 성질의 사용이
 *   한도를 먹었는지(긴 컨텍스트·장시간 세션·병렬) · 상위 스킬. 그 자리에 「approximate,
 *   based on local sessions on this machine」이라고 적혀 있으니 **그 말을 그대로 옮긴다.**
 *
 * 🔴 글을 그대로 보관한다. 서식이 바뀌면 파싱은 깨지지만 원문은 여전히 읽을 수 있다 —
 *   파싱 실패를 "사용량 0" 으로 보여주는 것이 이 저장소가 가장 싫어하는 부류다.
 */
export function claudeUsage({ ttlMs = 60000 } = {}) {
  const r = cached('usage', ttlMs, () => callJson(['-p', '/usage', '--output-format', 'json'], { timeout: 90000 }))
  const text = typeof r.data?.result === 'string' ? r.data.result : ''
  return {
    ok: r.ok && !!text,
    error: r.ok ? (text ? null : '/usage 가 빈 답을 줬다') : r.error,
    text,
    cached: r.cached,
    ageMs: r.ageMs,
  }
}

/** CLI 버전 — 한 번 읽으면 잘 바뀌지 않는다 */
export function cliVersion({ ttlMs = 600000 } = {}) {
  const hit = _cache.get('ver')
  if (hit && Date.now() - hit.at < ttlMs) return hit.v
  let v = null
  try {
    const exe = claudeBin()
    v = execFileSync(exe, ['--version'], {
      encoding: 'utf8', timeout: 20000, windowsHide: true, env: accountEnv(),
      stdio: ['ignore', 'pipe', 'pipe'], shell: needsShell(exe),
    }).trim()
  } catch { v = null }
  _cache.set('ver', { at: Date.now(), v })
  return v
}

/** 시험·강제 갱신용 */
export function clearCache() { _cache.clear() }
