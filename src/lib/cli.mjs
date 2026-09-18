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
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Windows npm 전역 설치는 claude.cmd 셸 심이다. Node 는 셸 없이 .cmd 를 못 띄운다 */
export function claudeBin(override = null) {
  if (override) return override
  const appdata = process.env.APPDATA
  if (appdata) {
    const c = join(appdata, 'npm', 'claude.cmd')
    if (existsSync(c)) return c
  }
  return 'claude'
}

/**
 * 계정 프로필이 이기도록 정리한 환경.
 * 지금은 어느 키도 설정돼 있지 않지만(실측), 나중에 누가 설정해도 이 도구는 흔들리지 않아야 한다.
 */
export function 계정환경(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  delete env.ANTHROPIC_PROFILE
  return env
}

/**
 * 셸로 넘길 인용. claude.cmd 경로에 공백이 있고, 셸을 거치지 않으면 .cmd 를 띄울 수 없다.
 * 인자를 배열로 넘기면서 shell:true 를 쓰면 Node 가 경고한다(인용을 안 해주므로) —
 * 그래서 명령 문자열을 직접 만든다.
 */
const q = (s) => (/[\s"&|<>^()]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : String(s))

/** CLI 를 한 번 부르고 JSON 으로 받는다. 실패는 던지지 않고 결과에 담는다 */
function callJson(args, { timeout = 20000, bin = null } = {}) {
  const cmd = [q(claudeBin(bin)), ...args.map(q)].join(' ')
  try {
    const out = execSync(cmd, {
      encoding: 'utf8', timeout, windowsHide: true, env: 계정환경(),
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, data: JSON.parse(out) }
  } catch (e) {
    return { ok: false, 오류: (e.stderr || e.message || String(e)).toString().slice(0, 500), data: null }
  }
}

/* ── TTL 캐시 ────────────────────────────────────────────────── */
/**
 * UI 가 몇 초마다 물어보는데 그때마다 프로세스를 띄우면 느리고 시끄럽다.
 * 짧은 TTL 로 캐시한다 — 실행 중 세션 목록은 몇 초 낡아도 무해하다.
 */
const _cache = new Map()
function cached(key, ttlMs, fn) {
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return { ...hit.v, 캐시됨: true, 나이ms: Date.now() - hit.at }
  const v = fn()
  _cache.set(key, { at: Date.now(), v })
  return { ...v, 캐시됨: false, 나이ms: 0 }
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
    오류: r.ok ? null : r.오류,
    캐시됨: r.캐시됨,
    sessions: list.map((s) => ({
      sessionId: s.sessionId,
      pid: s.pid,
      cwd: s.cwd,
      kind: s.kind,
      name: s.name,
      startedAtEpoch: s.startedAt,
      // 프로세스가 실제로 살아있는지 한 번 더 본다 — 목록이 낡아 있을 수 있다
      살아있음: 살아있나(s.pid),
    })),
  }
}

/** pid 가 살아있나. 신호 0 은 아무것도 보내지 않고 존재만 확인한다 */
export function 살아있나(pid) {
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
    오류: r.ok ? null : r.오류,
    캐시됨: r.캐시됨,
    loggedIn: !!d.loggedIn,
    email: d.email || null,
    orgName: d.orgName || null,
    orgId: d.orgId || null,
    authMethod: d.authMethod || null,
    apiProvider: d.apiProvider || null,
    subscriptionType: d.subscriptionType || null,
    // 구독이면 정가 환산은 참고값이다
    구독제: !!d.subscriptionType && d.subscriptionType !== 'api',
  }
}

/** CLI 버전 — 한 번 읽으면 잘 바뀌지 않는다 */
export function cliVersion({ ttlMs = 600000 } = {}) {
  const hit = _cache.get('ver')
  if (hit && Date.now() - hit.at < ttlMs) return hit.v
  let v = null
  try {
    v = execSync(`${q(claudeBin())} --version`, {
      encoding: 'utf8', timeout: 20000, windowsHide: true, env: 계정환경(),
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch { v = null }
  _cache.set('ver', { at: Date.now(), v })
  return v
}

/** 시험·강제 갱신용 */
export function 캐시비우기() { _cache.clear() }
