/**
 * ready.js — «자동 이어받기 조건» 안의 **이 PC 에서 돌 수 있나** 패널과 «이 PC 준비하기» 단추.
 *
 * 🔴 판정은 서버(lib/ready.mjs)가 한다. 화면은 그리기만 한다 — 화면이 제 나름대로 판정하면
 *   창구마다 다른 말을 한다(CLAUDE.md 화면 규칙). 무엇을 고칠지도 서버가 실행 직전에 다시 정한다.
 * 🔴 접힌 줄(summary)에도 요지를 남긴다 — 접어 둔 채로 «안 됨» 이 숨으면 안 된다.
 *
 * common.js 만 가져오는 잎이다. 부작용이 없다 — initReady() 를 불러야 배선된다.
 */
'use strict'
import { $, el, S, badge, actions } from './common.js'

/** 수준 → [배지 종류, 아이콘, 단어]. 색만으로 나르지 않는다 — 아이콘·단어를 함께 쓴다 */
const look = {
  ok: ['good', '✓', '됨'],
  warn: ['warn', '▲', '주의'],
  crit: ['crit', '✖', '안 됨'],
  unknown: ['serious', '?', '모름'],
  info: ['off', '●', '선택'],
}
const fixWord = { auto: '단추가 고침', manual: '직접' }

/** 적용 중인가 — 두 번 눌러 겹쳐 보내지 않게 한다(서버도 409 로 막는다) */
let busy = false
/** 다시 확인하는 중인가 — 적용과 겹치지 않게 한다(확인 도중 등록이 끼면 «바뀐 것» 이 섞인다) */
let checking = false

/** 접힌 줄의 요지 — **단어**로 쓴다. 무엇이 걸렸는지는 hover 와 펼친 표에 둔다 */
function drawDigest(v) {
  const box = $('#readyDigest')
  box.textContent = ''
  if (!v) { box.append(badge('serious', '?', 'PC 준비 모름', '판정을 읽지 못했다 — 준비됐다고 말하지 않는다')); return }
  const bad = v.items.filter((i) => i.level === 'crit' || i.level === 'unknown')
  const warn = v.items.filter((i) => i.level === 'warn')
  const names = (xs) => xs.map((i) => `${i.name}: ${i.now}`).join('\n')
  if (v.level === 'crit') box.append(badge('crit', '✖', `PC 준비 안 됨 · ${bad.length}`, names(bad)))
  else if (v.level === 'unknown') box.append(badge('serious', '?', `PC 준비 모름 · ${bad.length}`, names(bad)))
  else if (warn.length) box.append(badge('warn', '▲', `PC 준비됨 · 주의 ${warn.length}`, names(warn)))
  else box.append(badge('good', '✓', 'PC 준비됨', '이 PC 에서 RetrySession 이 돈다'))
}

/**
 * 판정에 쓴 값의 나이. 🔴 예약(30초)·전원(60초)은 캐시를 거친다 — 나이를 말하지 않으면
 *   «방금 등록했는데 왜 안 됨이지» 에서 멈춘다. 모르면 «모름» 이다(«방금» 이라고 하지 않는다).
 */
function drawAsOf(v) {
  const a = v?.asOf || {}
  const sec = (s) => (s === null || s === undefined ? '모름' : s < 2 ? '방금' : `${s}초 전`)
  $('#readyAt').textContent = v
    ? `읽은 값: 예약 ${sec(a.tasksSec)} · 전원 ${sec(a.pcSec)} (저절로는 예약 30초 · 전원·로그인 1분마다)`
    : ''
}

function drawButton(v) {
  const chk = $('#btnReadyCheck')
  chk.disabled = busy || checking
  chk.textContent = checking ? '확인하는 중…' : '다시 확인'
  const btn = $('#btnReady')
  const auto = (v?.items || []).filter((i) => i.fix === 'auto')
  btn.disabled = busy || checking || !auto.length
  btn.textContent = busy ? '적용하는 중…' : auto.length ? `이 PC 준비하기 (${auto.length})` : '이 PC 준비하기'
  btn.title = auto.length
    ? `단추가 고치는 것: ${auto.map((i) => i.name).join(' · ')}`
    : '단추가 고칠 것이 없다 — 남은 것은 «직접» 이라고 적힌 항목이다'
}

export function drawReady(d) {
  const v = d?.ready || null
  drawDigest(v)
  drawButton(v)
  drawAsOf(v)
  const list = $('#readyList')
  list.textContent = ''
  if (!v) { list.append(el('div', 'rwhy', '판정을 읽지 못했다 — 준비됐다고 말하지 않는다')); return }
  for (const it of v.items) {
    const [kind, ic, word] = look[it.level] || look.unknown
    const row = el('div', 'rrow')
    const top = el('div', 'rtop')
    top.append(badge(kind, ic, word, it.why), el('b', 'rname', it.name), el('span', 'rnow', it.now))
    if (it.fix) top.append(el('span', 'rfix ' + it.fix, fixWord[it.fix] || it.fix))
    row.append(top)
    // 괜찮은 줄은 한 줄로 — 이유는 hover 에 있다. 아닌 줄은 이유와 방법을 **보이게** 적는다
    if (it.level !== 'ok' && it.why) row.append(el('div', 'rwhy', it.why))
    if (it.how) row.append(el('div', 'rhow', it.how))
    list.append(row)
  }
}

const lastLine = (s) => String(s || '').trim().split(/\r?\n/).filter(Boolean).pop() || '이유를 받지 못했다'

/** 누른 결과를 말한다 — 반응 없는 화면은 고장난 화면과 구별되지 않는다 */
function resultText(r) {
  if (!r) return '✖ 보내지 못했습니다 — 서버가 바쁘거나 멈췄을 수 있습니다'
  if (r.error) return `✖ 적용하지 못했습니다 — ${r.error}`
  if (r.nothing) return '고칠 것이 없었습니다 — 화면이 몇 초 묵어 있었습니다(다시 읽습니다)'
  const res = r.results || []
  const bad = res.filter((x) => !x.ok)
  if (!bad.length) return `✅ ${res.length}단계 적용 — ${res.map((x) => x.name).join(' · ')}\n예약 상태는 몇 초 뒤에 화면에 반영됩니다`
  return `✖ ${res.length}단계 중 ${bad.length}단계 실패\n` +
    bad.map((x) => `· ${x.name}${x.skipped ? ' (건너뜀)' : ''}: ${lastLine(x.output)}`).join('\n')
}

/** 다시 확인한 결과 — **무엇이 바뀌었는지** 말한다(같은 표가 다시 그려지면 바뀐 것을 못 찾는다) */
function checkText(r, before, after) {
  if (!r) return '✖ 보내지 못했습니다 — 서버가 바쁘거나 멈췄을 수 있습니다'
  if (r.error) return `✖ 다시 확인하지 못했습니다 — ${r.error}`
  const was = new Map((before?.items || []).map((i) => [i.key, i]))
  const word = (lv) => (look[lv] || look.unknown)[2]
  const changed = (after?.items || [])
    .filter((i) => was.has(i.key) && (was.get(i.key).level !== i.level || was.get(i.key).now !== i.now))
    .map((i) => `· ${i.name}: ${word(was.get(i.key).level)} → ${word(i.level)} (${i.now})`)
  return `🔄 ${r.at || ''} 다시 확인했습니다 — ` + (changed.length ? `바뀐 것 ${changed.length}개\n${changed.join('\n')}` : '바뀐 것 없음')
}

/**
 * «다시 확인» — 서버가 예약·로그인·전원·PATH 를 **지금** 다시 읽고, 화면은 이어서 상태를 읽는다.
 * 🔴 판정은 그 상태 조회가 한다(서버의 같은 길). 여기서 응답으로 받은 것을 따로 그리지 않는다.
 */
async function checkReady() {
  if (busy || checking) return
  const before = S.state?.ready || null
  checking = true
  drawButton(before)
  const msg = $('#readyMsg')
  msg.textContent = '다시 확인하는 중… (예약·로그인 조회에 몇 초 걸립니다)'
  try {
    // post 는 끝난 뒤 상태를 다시 읽는다 — 그래서 여기서 S.state 가 새 판정이다
    const r = await actions.post('/api/ready', { action: 'check' })
    msg.textContent = checkText(r, before, S.state?.ready)
  } finally {
    checking = false
    actions.draw()
  }
}

async function applyReady() {
  const auto = (S.state?.ready?.items || []).filter((i) => i.fix === 'auto')
  if (busy || checking || !auto.length) return
  const power = auto.some((i) => i.key === 'power')
  if (!confirm([
    '이 PC 를 RetrySession 이 돌 수 있게 맞춥니다.',
    '',
    ...auto.map((i) => `· ${i.name} — 지금: ${i.now}`),
    '',
    ...(power ? ['전원은 «전원 연결 시 잠들지 않기» 로 바꿉니다. 바꾸기 전 값을 보관하므로 설정 창에서',
      '되돌릴 수 있습니다(배터리 설정은 건드리지 않습니다).', ''] : []),
    '하지 않는 것: 재시작 작업 등록(사람 없이 토큰을 씁니다) · 로그인 · 설정 파일 · PATH.',
    '작업 등록에 몇 초씩 걸립니다. 계속할까요?',
  ].join('\n'))) return

  busy = true
  drawButton(S.state?.ready)
  const msg = $('#readyMsg')
  msg.textContent = '적용하는 중… (작업 등록에 몇 초씩 걸립니다)'
  try {
    msg.textContent = resultText(await actions.post('/api/ready', { action: 'apply' }))
  } finally {
    busy = false
    actions.draw()
  }
}

export function initReady() {
  $('#btnReady')?.addEventListener('click', applyReady)
  $('#btnReadyCheck')?.addEventListener('click', checkReady)
}
