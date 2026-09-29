/**
 * usage.mjs — **사용량 상세**를 한곳에 모은다. 화면 맨 위의 사용량 패널이 이것을 읽는다.
 *
 * 세 출처를 합친다 — 출처마다 아는 것이 다르고, 섞으면 거짓이 된다:
 *   `/usage` (CLI)        → 최근 24시간·7일의 요청 수·세션 수·성질(긴 컨텍스트·장시간·병렬)
 *                           🔴 그쪽이 「이 기계의 로컬 세션 기준 근사값」이라고 말한다. 그대로 옮긴다.
 *   `quotaLimits` (기록)  → 지금 걸린 제한 창: 유형·상태·해제 시각·초과분
 *   우리 집계 (트랜스크립트) → 토큰·정가(오늘/누적)·모델별. 실측이고 우리가 계산한 값이다.
 *
 * 🔴 파싱이 깨져도 **원문을 함께 돌려준다.** 서식이 바뀌면 숫자는 못 뽑아도 사람은 읽을 수
 *   있어야 한다 — 파싱 실패를 "사용량 0" 으로 보여주는 것이 최악이다.
 */
import { join } from 'node:path'
import { readFileSync, mkdirSync } from 'node:fs'
import { account, claudeUsage } from './cli.mjs'
import { scanSessions } from './sessions.mjs'
import { totalCost } from './pricing.mjs'
import { sumTokens } from './session-fold.mjs'
import { mergeHours } from './hours.mjs'
import { learnBaseline, windowViews } from './limit-window.mjs'
import { limitState } from './guard.mjs'
import { RS_HOME } from './config.mjs'
import { writeJsonAtomic } from './io.mjs'
import { localStamp, dayKey } from './stamp.mjs'

/**
 * `/usage` 의 글을 구조로. **순수 함수** — 실측한 원문으로 시험한다.
 *
 * 실측 원문(2026-09-28)의 모양:
 * ```
 * You are currently using your subscription to power your Claude Code usage
 *
 * What's contributing to your limits usage?
 * Approximate, based on local sessions on this machine — does not include …
 *
 * Last 24h · 1848 requests · 5 sessions
 *   98% of your usage was at >150k context
 *   Top skills: /tests-manual-sync 1%, /tests-verify 1%
 * ```
 * 🔴 한 줄도 없을 때·형식이 다를 때 **던지지 않는다.** 못 읽은 것은 `null`·`[]` 로 두고
 *   `raw` 를 남긴다. 던지면 패널이 통째로 비고, 빈 화면은 아무 말도 하지 않는다.
 */
export function parseUsageText(text) {
  const raw = String(text || '')
  const lines = raw.split('\n')
  const windows = []
  let current = null
  for (const line of lines) {
    const head = /^\s*(Last\s+\S+)\s*·\s*([\d,]+)\s+requests?\s*·\s*([\d,]+)\s+sessions?/i.exec(line)
    if (head) {
      current = { label: head[1].trim(), requests: num(head[2]), sessions: num(head[3]), traits: [], skills: [] }
      windows.push(current)
      continue
    }
    if (!current) continue
    const body = line.trim()
    if (!body) { current = null; continue }
    const skills = /^Top skills:\s*(.+)$/i.exec(body)
    if (skills) {
      current.skills = skills[1].split(',').map((s) => s.trim()).filter(Boolean)
      continue
    }
    // `98% of your usage was at >150k context` → { percent: 98, what: '>150k context 에서' }
    const pct = /^(\d+)%\s+(.*)$/.exec(body)
    if (pct) current.traits.push({ percent: num(pct[1]), what: pct[2].trim() })
  }
  return {
    raw,
    subscription: /using your subscription/i.test(raw),
    /** 🔴 그쪽이 스스로 붙인 한정 조건 — 지우지 말고 화면에 함께 적는다 */
    approximate: /Approximate/i.test(raw),
    windows,
  }
}

const num = (s) => Number(String(s).replace(/,/g, '')) || 0

/** 제한 창을 사람이 읽는 모양으로. 원값도 함께 둔다(화면이 다시 계산하지 않게) */
function quotaDetail(quota, now = Date.now()) {
  if (!quota || typeof quota !== 'object') {
    return { exists: false, why: '아직 제한에 걸린 기록이 없다' }
  }
  const st = limitState(quota, now)
  return {
    exists: true,
    type: quota.rateLimitType || null,
    status: quota.status || null,
    limited: st.limited,
    leftMin: st.leftMin,
    resetsAt: st.liftedEpoch ? localStamp(new Date(st.liftedEpoch)) : null,
    usingOverage: !!quota.isUsingOverage,
    overageStatus: quota.overageStatus || null,
    overageDisabledReason: quota.overageDisabledReason || null,
    /** 🔴 이 값은 **관측된 시점**의 것이다. 지금 상태가 아닐 수 있다 — 화면이 그렇게 말한다 */
    observedAt: quota._at ? localStamp(new Date(quota._at)) : null,
  }
}

/* ── 창 기준선 (배운 것을 남긴다) ───────────────────────────── */

/**
 * 🔴 기준선은 **기록으로 남는다.** 제한에 걸린 사건은 드물고(며칠에 한 번), 시간 통은
 *   8일치만 들고 있다. 그때 배운 것을 적어 두지 않으면 통이 밀려 나가는 순간 잊고,
 *   화면은 다시 「기준선 없음」으로 돌아간다 — 한 번 안 것을 잊는 것은 결함이다.
 */
const baselineFile = () => {
  const d = join(RS_HOME, 'state')
  mkdirSync(d, { recursive: true })
  return join(d, 'limits.json')
}

function loadBaseline() {
  try { return JSON.parse(readFileSync(baselineFile(), 'utf8')) } catch { return {} }
}

/** 🔴 쓰기 실패가 보고를 막지 않는다 — 다음 회차에 다시 배운다 */
function saveBaseline(next) {
  try { writeJsonAtomic(baselineFile(), next) } catch { /* 기록 실패로 화면을 비우지 않는다 */ }
}

/** 모델별 오늘·누적을 합친다 (세션을 넘어서) */
function mergeByModel(sessions, pick) {
  const out = {}
  for (const s of sessions) {
    for (const [id, t] of Object.entries(pick(s) || {})) {
      const cur = out[id] || { input: 0, cacheWrite1h: 0, cacheWrite5m: 0, cacheRead: 0, output: 0, thinking: 0 }
      for (const k of Object.keys(cur)) cur[k] += t[k] || 0
      out[id] = cur
    }
  }
  return out
}

/**
 * 화면이 읽는 사용량 보고서.
 * @param fresh `갱신` 을 눌렀을 때 — 캐시를 건너뛰고 지금 값을 읽는다.
 */
export function usageReport({ fresh = false } = {}) {
  const ttl = fresh ? 0 : 60000
  const acct = account({ ttlMs: ttl })
  const cli = claudeUsage({ ttlMs: ttl })
  const scan = scanSessions()
  const sessions = scan.sessions || []

  const today = mergeByModel(sessions, (s) => s.todayByModel)
  const all = mergeByModel(sessions, (s) => s.byModel)
  const todayCost = totalCost(today)
  const allCost = totalCost(all)

  /**
   * 굴러가는 창 — 「Session (5hr)」·「Weekly (7 day)」.
   * 🔴 퍼센트는 **제한에 걸린 사건에서 배운 기준선**이 있을 때만 만든다(limit-window.mjs).
   */
  const hours = mergeHours(sessions.map((s) => s.hours))
  const baseline = learnBaseline(hours, scan.quota, loadBaseline())
  saveBaseline(baseline)

  return {
    at: localStamp(),
    atEpoch: Date.now(),
    fresh,
    account: {
      email: acct.email, plan: acct.subscriptionType, ok: acct.ok,
      authMethod: acct.authMethod, isSubscription: acct.isSubscription,
    },
    /** `/usage` 가 말하는 것 — 못 읽었으면 `error` 와 `raw` 가 남는다 */
    claude: { ok: cli.ok, error: cli.error, ...parseUsageText(cli.text) },
    quota: quotaDetail(scan.quota),
    /**
     * 🔴 그쪽(`/usage` 화면)의 백분율이 아니다 — 헤드리스로는 그 숫자를 받을 수 없다.
     *   우리가 잰 창 합이고, 기준선이 없으면 `pct: null` 로 둔다. 화면이 그렇게 말한다.
     */
    limits: windowViews(hours, baseline),
    /** 우리 실측 집계. 오늘은 **로컬 자정** 기준이고 언제나 누적 이하다 */
    measured: {
      dayKey: dayKey(),
      sessionCount: sessions.length,
      today: {
        tokens: sumTokens(today), usd: todayCost.usd, byModel: todayCost.byModel,
        userMsgs: sum(sessions, 'todayUserMsgs'), assistantMsgs: sum(sessions, 'todayAssistantMsgs'),
        toolCalls: sum(sessions, 'todayToolCalls'),
      },
      total: {
        tokens: sumTokens(all), usd: allCost.usd, byModel: allCost.byModel,
        userMsgs: sum(sessions, 'userMsgs'), assistantMsgs: sum(sessions, 'assistantMsgs'),
        toolCalls: sum(sessions, 'toolCalls'),
      },
      /** 🔴 구독이면 정가 환산은 청구액이 아니다. 화면이 이 문장을 그대로 보여준다 */
      costNote: acct.isSubscription
        ? `정가 환산 참고값 — 구독(${acct.subscriptionType})이므로 실제 청구액이 아니다`
        : '정가 기준 환산액',
    },
    scan: scan.scan,
  }
}

const sum = (list, key) => list.reduce((a, s) => a + (s[key] || 0), 0)
