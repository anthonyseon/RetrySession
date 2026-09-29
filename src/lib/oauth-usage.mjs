/**
 * oauth-usage.mjs — **공식 사용률**(`Session (5hr)` · `Weekly (7 day)`)을 그쪽에서 받아 온다.
 *
 * 🔴 왜 이 파일이 생겼나 (사용자 지적 2026-09-29)
 *   우리가 «실측 ÷ 배운 기준선» 으로 만든 백분율은 **틀렸다.** 사용자가 대화 안의 `/usage`
 *   에서 본 값은 `Session 7% · Weekly 40%` 였는데 화면은 100% 를 보여줬다. 추정은 추정이라
 *   고쳐도 맞지 않는다 — 한도의 단위도, 창의 시작점도 우리가 모른다.
 *
 * 🔴 헤드리스 `/usage` 로는 못 받는다(두 번 실측). 그 출력에는 「무엇이 한도를 먹었나」
 *   본문만 있고 막대·퍼센트가 없다. 기록(`quotaLimits`)·`claude auth status` 에도 없다.
 *
 *   그래서 **대화 화면이 쓰는 그 자리**에서 직접 받는다:
 *     `GET https://api.anthropic.com/api/oauth/usage`  (Authorization: Bearer <계정 토큰>)
 *   응답에 `five_hour.utilization` · `seven_day.utilization` · 각 `resets_at` 이 있다.
 *   실측(2026-09-29): 이 값이 사용자가 `/usage` 에서 본 숫자와 그대로 일치했다.
 *
 * 🔴 **토큰 취급**
 *   · 쓰는 것은 VS Code 에 로그인된 계정의 토큰(`~/.claude/.credentials.json`)이다 —
 *     API 키를 새로 만들지 않는다(CLAUDE.md §6).
 *   · 보내는 곳은 `api.anthropic.com` **하나뿐**이다. 로그·상태 파일·화면에 절대 남기지 않는다.
 *   · 토큰을 **갱신하지 않는다.** 만료됐으면 그렇게 말하고 멈춘다(갱신은 CLI 가 한다) —
 *     남의 자격증명을 우리가 주고받으면 실패가 어디서 났는지 알 수 없게 된다.
 *
 * 🔴 문서에 없는 자리다. 그래서 **깨지면 깨졌다고 말한다** — 값을 지어내지 않고,
 *   서식이 바뀌면 그 사실이 화면에 그대로 뜬다(`ok: false` + 이유).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { localStamp } from './stamp.mjs'

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const CRED = () => join(homedir(), '.claude', '.credentials.json')

/** 창 이름 — 대화 안 `/usage` 화면의 말 그대로 쓴다(사람이 본 단어로 찾을 수 있게) */
export const OFFICIAL_WINDOWS = [
  { field: 'five_hour', key: 'session5h', label: 'Session (5hr)' },
  { field: 'seven_day', key: 'weekly7d', label: 'Weekly (7 day)' },
]

/**
 * 토큰을 꺼낸다. 🔴 값을 돌려주지 않고 **필요한 곳에서만** 쓰도록 좁게 감싼다.
 * @returns `{ ok, token?, why?, expiresInMin? }`
 */
export function readToken(file = CRED()) {
  let j
  try { j = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
    return { ok: false, why: `로그인 정보를 읽을 수 없습니다 (${e.code || e.message}) — VS Code 에서 로그인하세요` }
  }
  const o = j?.claudeAiOauth
  if (!o?.accessToken) return { ok: false, why: '로그인 정보에 계정 토큰이 없습니다 — VS Code 에서 로그인하세요' }
  const left = Number.isFinite(o.expiresAt) ? Math.round((o.expiresAt - Date.now()) / 60000) : null
  /**
   * 🔴 만료된 토큰으로 **부르지 않는다.** 401 을 받아 오는 것보다, 왜 안 되는지 미리
   *   말하는 편이 사람에게 쓸모 있다(대화를 한 번 열면 CLI 가 알아서 갱신한다).
   */
  if (left !== null && left <= 0) {
    return { ok: false, why: '계정 토큰이 만료됐습니다 — Claude Code 를 한 번 열면 갱신됩니다', expiresInMin: left }
  }
  return { ok: true, token: o.accessToken, expiresInMin: left, plan: o.subscriptionType || null, tier: o.rateLimitTier || null }
}

/**
 * 응답을 화면이 읽는 모양으로. **순수 함수** — 실측 응답으로 시험한다.
 *
 * 🔴 `utilization` 이 없으면 그 창을 **만들지 않는다.** 0 으로 채우면 「여유 있다」가 거짓이 된다.
 */
export function parseOfficial(body, now = Date.now()) {
  const out = []
  for (const w of OFFICIAL_WINDOWS) {
    const v = body?.[w.field]
    if (!v || !Number.isFinite(v.utilization)) continue
    const resets = v.resets_at ? Date.parse(v.resets_at) : NaN
    out.push({
      key: w.key,
      label: w.label,
      pct: Math.round(v.utilization),
      resetsAt: Number.isFinite(resets) ? localStamp(new Date(resets)) : null,
      resetsInMin: Number.isFinite(resets) ? Math.round((resets - now) / 60000) : null,
      /** 그쪽이 함께 주는 심각도 — 색을 우리가 새로 정하지 않고 이것을 따른다 */
      severity: (body.limits || []).find((l) => l.percent === Math.round(v.utilization))?.severity || 'normal',
      lockedReason: v.locked_reason || null,
    })
  }
  return out
}

/** 60초 캐시 — 화면이 3초마다 부르더라도 그쪽을 두드리지 않는다 */
let box = { at: 0, data: null }

/**
 * 공식 사용률을 읽는다.
 * @param fresh `갱신` 을 눌렀을 때 — 캐시를 건너뛴다
 * @param fetchImpl 시험에서 갈아끼운다(그물을 타지 않고 계약만 본다)
 */
export async function officialUsage({ fresh = false, ttlMs = 60_000, fetchImpl = fetch, file = CRED() } = {}) {
  if (!fresh && box.data && Date.now() - box.at < ttlMs) return { ...box.data, cached: true }

  const t = readToken(file)
  if (!t.ok) return { ok: false, windows: [], error: t.why, at: localStamp() }

  let res, text
  try {
    res = await fetchImpl(ENDPOINT, {
      headers: { Authorization: `Bearer ${t.token}`, Accept: 'application/json' },
    })
    text = await res.text()
  } catch (e) {
    // 🔴 그물이 끊긴 것과 값이 0 인 것은 다른 사실이다
    return { ok: false, windows: [], error: `사용률을 받지 못했습니다 — ${e.message}`, at: localStamp() }
  }
  if (!res.ok) {
    const why = res.status === 401
      ? '계정 토큰이 거부됐습니다(401) — Claude Code 를 한 번 열면 갱신됩니다'
      : `사용률 조회가 실패했습니다 (HTTP ${res.status})`
    return { ok: false, windows: [], error: why, at: localStamp() }
  }
  let body
  try { body = JSON.parse(text) } catch {
    return { ok: false, windows: [], error: '사용률 응답을 해석할 수 없습니다(서식이 바뀐 것으로 보입니다)', at: localStamp() }
  }
  const windows = parseOfficial(body)
  const data = {
    ok: windows.length > 0,
    windows,
    error: windows.length ? null : '응답에 사용률 칸이 없습니다(서식이 바뀐 것으로 보입니다)',
    plan: t.plan,
    tier: t.tier,
    tokenExpiresInMin: t.expiresInMin,
    at: localStamp(),
  }
  box = { at: Date.now(), data }
  return { ...data, cached: false }
}

/** 시험에서 캐시를 비운다 */
export const resetOfficialCache = () => { box = { at: 0, data: null } }
