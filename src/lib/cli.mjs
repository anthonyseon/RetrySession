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
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
export function claudeBin(override = null) {
  if (override) return override
  const appdata = process.env.APPDATA
  if (appdata) {
    const exe = join(appdata, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (existsSync(exe)) return exe
    // 설치 형태가 다르면 심으로 물러선다 (이때는 호출부가 셸을 써야 한다)
    const cmd = join(appdata, 'npm', 'claude.cmd')
    if (existsSync(cmd)) return cmd
  }
  return 'claude'
}

/** 셸을 거쳐야 하는 경로인가 — .exe 면 필요 없다 */
export const 셸필요 = (bin) => !/\.exe$/i.test(String(bin))

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
 * CLI 를 한 번 부르고 JSON 으로 받는다. 실패는 던지지 않고 결과에 담는다.
 * 인자는 배열로 넘긴다 — 셸이 없으므로 인용도, 코드페이지 변환도 없다.
 */
function callJson(args, { timeout = 20000, bin = null } = {}) {
  const exe = claudeBin(bin)
  try {
    const out = execFileSync(exe, args, {
      encoding: 'utf8', timeout, windowsHide: true, env: 계정환경(),
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      shell: 셸필요(exe), // .exe 면 false — 콘솔 창이 뜨지 않는다
    })
    return { ok: true, data: JSON.parse(out) }
  } catch (e) {
    return { ok: false, 오류: 실패설명(exe, e), data: null }
  }
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
export function 실패설명(exe, e) {
  const raw = (e.stderr || e.message || String(e)).toString()
  const 깨짐 = raw.includes('�')   // 디코딩이 어긋났다는 확실한 표시
  if (깨짐 || e.code === 'ENOENT') {
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
    const exe = claudeBin()
    v = execFileSync(exe, ['--version'], {
      encoding: 'utf8', timeout: 20000, windowsHide: true, env: 계정환경(),
      stdio: ['ignore', 'pipe', 'pipe'], shell: 셸필요(exe),
    }).trim()
  } catch { v = null }
  _cache.set('ver', { at: Date.now(), v })
  return v
}

/** 시험·강제 갱신용 */
export function 캐시비우기() { _cache.clear() }
