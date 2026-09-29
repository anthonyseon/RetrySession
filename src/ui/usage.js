/**
 * usage.js — 화면 맨 위의 **사용량 상세** 패널.
 *
 * 🔴 왜 `/api/status` 에 끼우지 않았나
 *   이 패널의 절반은 `claude -p /usage` 를 실제로 불러 얻는다(실측 2~8초). 3초마다 도는
 *   상태 폴링에 끼우면 화면 전체가 그만큼 느려지고, 느린 화면은 사람이 닫는다.
 *   그래서 **따로** 읽는다 — 펼칠 때 한 번, 그리고 `갱신` 을 누를 때마다.
 *
 * 🔴 왜 자동으로 되풀이해 읽지 않나
 *   `/usage` 는 토큰을 쓰지 않지만(실측 `total_cost_usd: 0 · num_turns: 0`) 프로세스를
 *   띄우는 값은 있다. 사람이 볼 때만 읽는다 — 안 보는 값을 위해 계속 도는 것은 낭비다.
 *
 * 세 출처를 **갈라서** 보여준다. 섞으면 어느 것이 실측이고 어느 것이 근사인지 사라진다:
 *   ① `/usage` — 그쪽이 「이 기계의 로컬 세션 기준 근사값」이라고 말한다(그 말을 함께 적는다)
 *   ② 제한 창 — 우리가 **관측한 시점**의 기록이다(지금 상태가 아닐 수 있다고 적는다)
 *   ③ 우리 실측 — 트랜스크립트를 직접 세어 오늘/누적으로 가른다
 */
import { $, el, n, compact } from './common.js'

/** 마지막으로 읽은 보고서. `null` 은 «아직 안 읽었다» 다 — «0 이다» 와 구별한다 */
let U = null
let loading = false
let error = null

/* ── 읽기 ────────────────────────────────────────────────────── */

/**
 * @param fresh `갱신` 을 눌렀을 때 — 서버의 60초 캐시를 건너뛰고 지금 값을 읽는다.
 *
 * 🔴 실패를 삼키지 않는다. **0 으로 보이는 것**과 **못 읽은 것**은 다른 사실이고,
 *   0 으로 보여주면 사람은 «안 쓰고 있다» 로 읽는다.
 */
async function loadUsage({ fresh = false } = {}) {
  if (loading) return
  loading = true; error = null
  drawUsage()
  try {
    const r = await fetch('/api/usage' + (fresh ? '?fresh=1' : ''), { cache: 'no-store' })
    if (r.ok) U = await r.json()
    else error = `읽기 실패 (HTTP ${r.status})`
  } catch (e) { error = e?.message || String(e) }
  loading = false
  drawUsage()
}

/**
 * 펼칠 때 처음 한 번 읽는다. 🔴 접힌 채로는 읽지 않는다 — 안 보는 값을 위해
 * 기동할 때마다 `/usage` 를 부르면 화면이 뜨는 속도만 늦어진다.
 */
export function initUsage() {
  const box = $('#usageBox')
  if (!box) return
  box.addEventListener('toggle', () => { if (box.open && !U && !loading) loadUsage() })
  // 단추는 `<details>` 의 body 안이다 — summary 안이 아니므로 누를 때 접히지 않는다
  $('#btnUsage')?.addEventListener('click', () => loadUsage({ fresh: true }))
  drawUsage()
}

/* ── 그리기 ──────────────────────────────────────────────────── */

const dl = () => el('dl', 'kv')
const put = (box, k, v) => { box.append(el('dt', null, k), el('dd', null, v ?? '-')) }
const wrap = (tag, child) => { const x = el(tag); x.append(child); return x }

/** `Last 24h` → `최근 24시간`. 모르는 이름은 **그대로** 둔다(지어내지 않는다) */
const windowName = (label) => ({ 'Last 24h': '최근 24시간', 'Last 7d': '최근 7일' }[label] || label)

function drawUsage() {
  const digest = $('#usageDigest'), body = $('#usageMain'), at = $('#usageAt')
  if (!digest || !body) return
  body.textContent = ''

  if (loading) {
    digest.textContent = '읽는 중…'
    if (at) at.textContent = 'claude /usage 를 부르는 중입니다 (몇 초 걸립니다)'
    body.append(el('div', 'note', '읽는 중입니다 — 이 패널은 상태 폴링과 따로 돕니다.'))
    return
  }
  if (error) {
    digest.textContent = '읽지 못했습니다'
    if (at) at.textContent = error
    body.append(el('div', 'warnbox', `▲ 사용량을 읽지 못했습니다 — ${error}`))
    return
  }
  if (!U) {
    digest.textContent = '펼치면 읽습니다 — 토큰 · 요청 수 · 제한 상태'
    if (at) at.textContent = '아직 읽지 않았습니다'
    return
  }

  if (at) {
    at.textContent = `${U.at} 기준` + (U.fresh ? ' · 지금 읽은 값' : ' · 최대 60초 캐시')
      + ` · 세션 ${n(U.measured?.sessionCount || 0)}개를 셌습니다`
  }
  digest.textContent = digestLine(U)
  body.append(...limitsBlock(U), ...accountBlock(U), ...claudeBlock(U), ...quotaBlock(U), ...measuredBlock(U))
}

/** 접힌 채로도 보이는 한 줄 — 창 사용률, 오늘 몫, 제한 상태 */
function digestLine(u) {
  const t = u.measured?.today || {}
  const q = u.quota || {}
  // 🔴 창 사용률을 맨 앞에 — 사람이 가장 먼저 묻는 것이 「얼마나 남았나」다.
  //   공식 값을 못 받았으면 `?` 다. 실측으로 메운 숫자를 여기 적으면 사람이 그것을 믿는다.
  const wins = (u.limits || []).map((w) => `${w.label} ${w.pct === null ? '?' : w.pct + '%'}`)
  return [
    ...wins,
    `오늘 토큰 ${compact(t.tokens || 0)} · 정가 $${(t.usd || 0).toFixed(2)}`,
    q.exists ? (q.limited ? `🔴 제한 중 (${q.leftMin}분 남음)` : '제한 없음') : '제한 기록 없음',
  ].filter(Boolean).join(' · ')
}

/* ── 굴러가는 창: Session (5hr) · Weekly (7 day) ─────────────── */

/**
 * 🔴 **백분율은 공식 값이다** (사용자 지적 2026-09-29).
 *   예전에는 우리 실측을 «제한에 걸린 창» 으로 나눠 추정했는데, 사용자가 대화 안 `/usage`
 *   에서 본 `Session 7% · Weekly 40%` 와 달리 화면은 100% 를 보여줬다. 한도의 단위도 창의
 *   시작점도 우리가 모르니 추정으로는 맞출 수 없다. 그래서 대화 화면이 쓰는 그 자리에서
 *   받아 온다(`lib/oauth-usage.mjs`).
 *
 * 🔴 받지 못하면 **숫자를 만들지 않는다.** 실측 토큰으로 메우면 그게 다시 추정이다.
 *   그 자리에는 «받지 못했다 + 이유» 를 적고, 사람이 `/usage` 로 직접 볼 수 있게 말한다.
 *
 * 🔴 색은 **그쪽이 준 severity** 를 먼저 따르고, 없으면 퍼센트로 정한다 — 경고의 기준을
 *   우리가 새로 발명하지 않는다.
 */
function limitsBlock(u) {
  const list = u.limits || []
  if (!list.length) return []
  const out = [el('h3', null, '창 사용률 (Claude 공식 값)')]
  if (u.officialError) {
    out.push(el('div', 'warnbox', `▲ 공식 사용률을 받지 못했습니다 — ${u.officialError}`))
    out.push(el('div', 'note', '아래 토큰은 우리 실측입니다. 정확한 퍼센트는 대화 안에서 `/usage` 로 볼 수 있습니다.'))
  }
  for (const w of list) {
    /**
     * 🔴 **그쪽이 severity 를 주면 그것을 따른다** — 값이 `normal` 이어도 그렇다.
     *   퍼센트로 우리가 다시 판정하면(예: 95% 니까 빨강) 그쪽이 «괜찮다» 고 한 것을
     *   우리가 «위험» 이라 부르는 셈이다. 우리 기준을 그쪽 기준 위에 얹지 않는다.
     *   severity 가 아예 없을 때만 퍼센트로 정한다(그때는 우리밖에 판정할 사람이 없다).
     */
    const tone = w.pct === null ? ' unknown'
      : w.severity ? (w.severity === 'critical' ? ' crit' : w.severity === 'warning' ? ' warn' : '')
        : w.pct >= 90 ? ' crit' : w.pct >= 70 ? ' warn' : ''
    const row = el('div', 'urow wlimit')
    row.append(el('b', null, w.label))
    row.append(el('span', 'wpct' + tone, w.pct === null ? '받지 못함' : `${w.pct}%`))
    const bits = []
    if (w.resetsAt) bits.push(`${w.resetsAt} 초기화` + (w.resetsInMin != null ? ` (${fmtLeft(w.resetsInMin)})` : ''))
    if (w.measured) bits.push(`우리 실측 토큰 ${compact(w.measured.tokens)} (참고 · 굴러가는 창)`)
    if (w.lockedReason) bits.push(`🔴 ${w.lockedReason}`)
    row.append(el('span', 'muted', bits.join(' · ')))
    row.title = w.pct === null
      ? '공식 사용률을 받지 못했습니다 — 옆의 토큰은 우리 실측이고 퍼센트의 분자가 아닙니다.'
      : `Claude 계정의 공식 사용률입니다(대화 안 /usage 와 같은 값). 옆의 토큰은 우리가 센 것이고 단위가 달라 나누지 않습니다.`
    out.push(row)
    if (w.pct !== null) {
      const m = el('div', 'meter' + tone)
      const i = el('i'); i.style.width = Math.min(100, w.pct) + '%'
      m.append(i); out.push(m)
    }
  }
  out.push(el('div', 'note',
    '퍼센트와 초기화 시각은 **Claude 계정의 공식 값**입니다(로그인된 계정으로 읽습니다). '
    + '토큰은 우리가 트랜스크립트에서 센 값이고 이 기계의 세션만 봅니다 — 둘은 단위가 달라 나누지 않습니다.'))
  return out
}

/** 남은 시간을 사람 말로 — 분이 6110 이면 「4일 5시간」이 읽힌다 */
function fmtLeft(min) {
  if (min < 0) return '지났습니다'
  if (min < 60) return `${min}분 뒤`
  const h = Math.floor(min / 60), d = Math.floor(h / 24)
  return d > 0 ? `${d}일 ${h % 24}시간 뒤` : `${h}시간 ${min % 60}분 뒤`
}

function accountBlock(u) {
  const a = u.account || {}
  const d = dl()
  put(d, '계정', `${a.email || '확인 실패'} · ${a.plan || '?'} · ${a.authMethod || '?'}`
    + (a.isSubscription ? ' (구독)' : ' (구독 아님)'))
  return [d]
}

/* ── ① Claude 가 말하는 것 ───────────────────────────────────── */

function claudeBlock(u) {
  const c = u.claude || {}
  const out = [el('h3', null, 'Claude 가 말하는 사용량 (/usage)')]
  if (!c.ok) {
    out.push(el('div', 'warnbox', `▲ /usage 를 읽지 못했습니다 — ${c.error || '이유 없음'}`))
    if (c.raw) out.push(rawDetails(c.raw))
    return out
  }
  /** 🔴 그쪽이 스스로 붙인 한정 조건. 지우면 근사값이 실측처럼 보인다 */
  if (c.approximate) {
    out.push(el('div', 'note',
      '이 기계의 로컬 세션 기준 근사값입니다 — 다른 기기와 claude.ai 사용은 들어 있지 않습니다. '
      + '각 줄은 독립된 성질이고 합계를 쪼갠 것이 아닙니다 (그쪽이 붙인 한정 조건 그대로).'))
  }
  if (!c.windows?.length) {
    out.push(el('div', 'warnbox', '▲ 숫자를 못 뽑았습니다 — 서식이 바뀐 것으로 보입니다. 원문은 아래에 그대로 둡니다.'))
    out.push(rawDetails(c.raw))
    return out
  }
  const d = dl()
  for (const w of c.windows) {
    const lines = [`요청 ${n(w.requests)} · 세션 ${n(w.sessions)}`]
    for (const t of w.traits || []) lines.push(`${t.percent}% — ${t.what}`)
    if (w.skills?.length) lines.push('스킬: ' + w.skills.join(' · '))
    put(d, windowName(w.label), lines.join('\n'))
  }
  out.push(d)
  out.push(el('div', 'note', '성질·스킬 줄은 Claude 가 준 원문입니다 — 옮기다 뜻이 바뀌면 근거가 사라지므로 번역하지 않습니다.'))
  out.push(rawDetails(c.raw))
  return out
}

/**
 * 원문은 접어서 둔다.
 *
 * 🔴 서식이 바뀌어 파싱이 깨진 날, 이것만 있으면 사람은 읽을 수 있다. 파싱 실패를
 *   «사용량 0» 으로 보여주는 것이 이 저장소가 가장 싫어하는 부류의 거짓이다.
 */
function rawDetails(raw) {
  const box = el('details', 'rawbox')
  const p = el('pre', 'log'); p.textContent = raw || '(원문 없음)'
  box.append(el('summary', null, '원문 보기 (/usage 출력 그대로)'), p)
  return box
}

/* ── ② 제한 창 ───────────────────────────────────────────────── */

function quotaBlock(u) {
  const q = u.quota || {}
  const out = [el('h3', null, '사용량 제한')]
  if (!q.exists) {
    out.push(el('div', 'note', q.why || '아직 제한에 걸린 기록이 없습니다.'))
    return out
  }
  const d = dl()
  put(d, '지금', q.limited ? `🔴 제한 중 — ${q.leftMin}분 남음` : '제한 없음')
  put(d, '유형 · 상태', `${q.type || '?'} · ${q.status || '?'}`)
  put(d, '해제 시각', q.resetsAt || '-')
  put(d, '초과분(overage)', q.usingOverage ? '쓰는 중'
    : `쓰지 않음 (${q.overageStatus || '?'}${q.overageDisabledReason ? ' · ' + q.overageDisabledReason : ''})`)
  put(d, '관측 시각', q.observedAt || '-')
  out.push(d)
  /** 🔴 관측 시점의 값이다. "지금"이라 말해 놓고 옛 기록을 보여주면 안 된다 */
  out.push(el('div', 'note',
    '제한 정보는 그 시각에 관측한 기록입니다 — 트랜스크립트에 제한 알림이 남은 시점입니다. '
    + '그 뒤에 새 제한이 걸렸다면 아직 모를 수 있습니다.'))
  return out
}

/* ── ③ 우리 실측 ─────────────────────────────────────────────── */

function measuredBlock(u) {
  const m = u.measured || {}
  const out = [el('h3', null, '우리 실측 (트랜스크립트)')]
  const d = dl()
  const row = (k, x) => put(d, k, `턴 u${n(x.userMsgs)}/a${n(x.assistantMsgs)} · 도구 ${n(x.toolCalls)}`
    + ` · 토큰 ${compact(x.tokens)} · 정가 $${(x.usd || 0).toFixed(2)}`)
  row(`오늘 (${m.dayKey || '로컬 자정 기준'})`, m.today || {})
  row('누적', m.total || {})
  out.push(d)
  out.push(el('div', 'note',
    `토큰은 실측이고 금액은 정가 환산입니다. ${m.costNote || ''} `
    + '오늘은 로컬 자정 기준이라 언제나 누적 이하입니다.'))
  const tb = modelTable(m.today?.byModel, m.total?.byModel)
  if (tb) out.push(el('div', 'note', '모델별 — 오늘 / 누적'), tb)
  return out
}

/**
 * 모델별 오늘·누적을 **한 표**에 둔다.
 *
 * 🔴 표를 두 개로 나누면 같은 모델을 두 번 찾아야 한다. «오늘 ≤ 누적» 도 같은 줄에서
 *   봐야 눈에 보인다 — 그 불변식이 깨져 보이면 집계가 틀린 것이다.
 */
function modelTable(today = {}, total = {}) {
  const ids = [...new Set([...Object.keys(today || {}), ...Object.keys(total || {})])]
    // 🔴 오늘도 누적도 0 인 모델은 줄만 차지한다 (`<synthetic>` 같은 자리표시자)
    .filter((id) => tok(today[id]) > 0 || tok(total[id]) > 0)
  if (!ids.length) return null
  const tb = el('table', 'models')
  const head = el('tr')
  for (const h of ['모델', '오늘 토큰', '오늘 정가', '누적 토큰', '누적 정가']) head.append(el('th', null, h))
  tb.append(wrap('thead', head))
  const body = el('tbody')
  for (const id of ids.sort((a, b) => tok(total[b]) - tok(total[a]))) {
    const a = today[id], b = total[id]
    const r = el('tr')
    r.append(el('td', null, id + (a?.estimated || b?.estimated ? ' (추정)' : '')),
      el('td', null, compact(tok(a))), el('td', null, '$' + (a?.usd || 0).toFixed(2)),
      el('td', null, compact(tok(b))), el('td', null, '$' + (b?.usd || 0).toFixed(2)))
    body.append(r)
  }
  tb.append(body)
  return tb
}

const tok = (t) => t
  ? (t.input || 0) + (t.cacheWrite1h || 0) + (t.cacheWrite5m || 0) + (t.cacheRead || 0) + (t.output || 0)
  : 0
