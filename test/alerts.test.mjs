/**
 * alerts.test.mjs — 경보 판정을 고정한다.
 *
 * 왜 이 판정이 한 곳이어야 하나
 *   Windows 풍선 알림을 걷어내고 알림을 화면으로 옮겼다(너무 자주 떠서 진짜 경고가
 *   묻혔다). 이제 화면 배너·트레이 개수·경보 로그가 모두 이 함수 하나를 본다.
 *   여기가 흔들리면 세 창구가 서로 다른 말을 한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentAlerts, fingerprint, levelOrder } from '../src/lib/alerts.mjs'

const fallback = (o = {}) => ({
  sessions: [], tasks: {}, quota: { exists: false }, locks: {}, ...o,
})
const sessions = (o = {}) => ({
  sessionId: 's1', shortId: 's1', title: '테스트 세션',
  watch: { on: false }, restart: { on: false }, tracker: {}, ...o,
})
const codes = (d) => currentAlerts(d).map((a) => a.code)

test('아무 문제 없으면 경보가 없다', () => {
  assert.deepEqual(currentAlerts(fallback()), [])
})

test('빈 입력에도 던지지 않는다', () => {
  assert.deepEqual(currentAlerts(null), [])
  assert.deepEqual(currentAlerts(undefined), [])
})

/* ── 감시 ────────────────────────────────────────────────────── */

test('🔴 감시가 끊기면 치명 경보 — 이 도구의 존재 이유다', () => {
  const d = fallback({ sessions: [sessions({ watch: { on: true, verdict: { alive: false, why: '20분 전 기록' } } })] })
  const [a] = currentAlerts(d)
  assert.equal(a.code, '감시끊김')
  assert.equal(a.level, 'critical')
  assert.match(a.desc, /20분 전 기록/)
  assert.equal(a.target, 's1', '눌러서 그 세션으로 갈 수 있어야 한다')
})

test('감시가 꺼져 있으면 끊김 경보를 내지 않는다', () => {
  const d = fallback({ sessions: [sessions({ watch: { on: false, verdict: { alive: false, why: 'x' } } })] })
  assert.deepEqual(codes(d), [])
})

test('감시가 살아 있으면 경보가 없다', () => {
  const d = fallback({ sessions: [sessions({ watch: { on: true, verdict: { alive: true } } })] })
  assert.deepEqual(codes(d), [])
})

/* ── 재시작 ──────────────────────────────────────────────────── */

test('재시작 회로 차단은 치명 경보', () => {
  const d = fallback({ sessions: [sessions({ restart: { on: true, blocked: { reason: '연속 3회 실패', at: 'x' } } })] })
  const [a] = currentAlerts(d)
  assert.equal(a.code, '재시작차단')
  assert.equal(a.level, 'critical')
})

test('상태 파일 손상도 치명 경보', () => {
  const d = fallback({ sessions: [sessions({ restart: { on: true, corrupt: '파일이 깨졌다' } })] })
  assert.ok(codes(d).includes('상태손상'))
})

test('재시작이 꺼져 있으면 차단 경보를 내지 않는다', () => {
  const d = fallback({ sessions: [sessions({ restart: { on: false, blocked: { reason: 'x', at: 'y' } } })] })
  assert.deepEqual(codes(d), [])
})

/* ── 예약 작업 ───────────────────────────────────────────────── */

test('🔴 예약 미등록은 경보 — 없으면 세션 밖에서 아무것도 돌지 않는다', () => {
  const d = fallback({ tasks: { heartbeat: { name: 'T', registered: false } } })
  const [a] = currentAlerts(d)
  assert.equal(a.code, '예약미등록')
  assert.match(a.desc, /start\.exe -Install/)
})

test('예약 실패와 조회 실패를 구별한다 — 대처가 다르다', () => {
  assert.deepEqual(codes(fallback({ tasks: { UI: { name: 'T', registered: true, healthy: false, resultText: '오류(2)' } } })), ['예약실패'])
  assert.deepEqual(codes(fallback({ tasks: { UI: { name: 'T', queryFailed: true, error: '권한 없음' } } })), ['예약조회실패'])
})

test('정상 등록된 작업은 경보가 없다 (캐시됨 키는 무시한다)', () => {
  const d = fallback({ tasks: { heartbeat: { name: 'T', registered: true, healthy: true }, cached: true } })
  assert.deepEqual(codes(d), [])
})

/* ── 사용량 제한 ─────────────────────────────────────────────── */

test('제한이 걸려 있으면 경보', () => {
  const d = fallback({ quota: { exists: true, alreadyLifted: false, desc: '30분 후 해제' } })
  assert.deepEqual(codes(d), ['사용량제한'])
})

test('🔴 이미 해제된 과거 기록은 경보가 아니다', () => {
  const d = fallback({ quota: { exists: true, alreadyLifted: true, desc: '이미 해제됐다' } })
  assert.deepEqual(codes(d), [], '지난 일로 계속 알리면 진짜 경고가 묻힌다')
})

/* ── 기타 ────────────────────────────────────────────────────── */

test('유령 락은 정보 수준으로만 알린다 (다음 실행이 스스로 회수한다)', () => {
  const d = fallback({ locks: { heartbeat: { stale: true, pid: 123, ageMin: 90 } } })
  const [a] = currentAlerts(d)
  assert.equal(a.code, '유령락')
  assert.equal(a.level, 'info')
})

test('doing 규약 위반을 알린다', () => {
  const d = fallback({ sessions: [sessions({ tracker: { doingViolations: ['A', 'B'] } })] })
  assert.deepEqual(codes(d), ['doing위반'])
})

/* ── 정렬과 지문 ─────────────────────────────────────────────── */

test('🔴 치명이 먼저 온다 — 배너 맨 위가 가장 급한 것이어야 한다', () => {
  const d = fallback({
    quota: { exists: true, alreadyLifted: false, desc: 'x' },
    locks: { ui: { stale: true, pid: 1, ageMin: 99 } },
    sessions: [sessions({ watch: { on: true, verdict: { alive: false, why: 'x' } } })],
  })
  const level = currentAlerts(d).map((a) => a.level)
  assert.equal(level[0], 'critical')
  for (let i = 1; i < level.length; i++) {
    assert.ok(levelOrder[level[i - 1]] >= levelOrder[level[i]], '수준 내림차순이어야 한다')
  }
})

test('지문 — 같은 상태면 같고, 달라지면 다르다 (변화만 기록하는 근거)', () => {
  const a = fallback({ sessions: [sessions({ watch: { on: true, verdict: { alive: false, why: '20분' } } })] })
  const b = fallback({ sessions: [sessions({ watch: { on: true, verdict: { alive: false, why: '25분' } } })] })
  // 설명이 달라도 같은 문제이므로 같은 지문 — 5분마다 같은 줄이 쌓이지 않게
  assert.equal(fingerprint(currentAlerts(a)), fingerprint(currentAlerts(b)))
  assert.notEqual(fingerprint(currentAlerts(a)), fingerprint(currentAlerts(fallback())))
})

test('지문 — 경보가 없으면 (없음)', () => {
  assert.equal(fingerprint([]), '(없음)')
})

test('지문 — 대상이 다르면 다른 지문 (다른 세션이 끊긴 것은 새 사건이다)', () => {
  const mk = (id) => fallback({ sessions: [sessions({ sessionId: id, watch: { on: true, verdict: { alive: false, why: 'x' } } })] })
  assert.notEqual(fingerprint(currentAlerts(mk('s1'))), fingerprint(currentAlerts(mk('s2'))))
})

/* ── 출처가 조용히 죽는 경우 ─────────────────────────────────── */

/**
 * 🔴 실측 결함 (2026-09-21)
 *   fullStatus() 는 `agents조회: {ok, 오류}` 를 담고 있었지만 **아무도 읽지 않았다.**
 *   그래서 `claude agents --json` 이 실패하면 목록이 비어 모든 세션이 조용히
 *   '정지'로 보였다 — 화면에도, 하트비트 기록에도, 트레이 개수에도.
 *   동시에 자율 재개는 fail-closed 로 멈춘다. 겉은 조용한데 아무것도 안 도는 상태다.
 */
test('🔴 실행 중 조회가 실패하면 경보가 뜬다 (조용히 넘어가면 안 된다)', () => {
  const a = currentAlerts({ sessions: [], tasks: {}, locks: {}, totals: { runKnown: false, runQueryError: 'claude 없음' } })
  const hit = a.find((x) => x.code === '실행조회실패')
  assert.ok(hit, '조회 실패를 알리는 경보가 있어야 한다')
  assert.equal(hit.level, 'critical', '재개가 멈추는 상태다 — 경고가 아니라 치명이다')
  assert.match(hit.desc, /claude 없음/, '왜 실패했는지 함께 적어야 조치할 수 있다')
})

test('조회가 성공했으면 그 경보는 없다', () => {
  const a = currentAlerts({ sessions: [], tasks: {}, locks: {}, totals: { runKnown: true } })
  assert.equal(a.find((x) => x.code === '실행조회실패'), undefined)
})

test('합계가 없는 옛 데이터로도 터지지 않는다', () => {
  assert.doesNotThrow(() => currentAlerts({ sessions: [], tasks: {}, locks: {} }))
})

/* ── 대기 중에는 경보를 내지 않는다 ─────────────────────────── */

test('🔴 첫 기록을 기다리는 중에는 감시끊김 경보를 내지 않는다 (실측 거짓 경보)', () => {
  const d = {
    sessions: [{ sessionId: 'a', shortId: 'a', title: 'ChatTest 실행',
      watch: { on: true, verdict: { alive: false, waiting: true, why: '감시를 켠 지 1분 — 첫 기록을 기다리는 중' } },
      restart: {}, tracker: {} }],
    tasks: {}, locks: {}, totals: { runKnown: true },
  }
  assert.equal(currentAlerts(d).find((x) => x.code === '감시끊김'), undefined,
    '아무것도 고장나지 않았는데 치명 경보를 띄우면 진짜 경보가 묻힌다')
})

test('대기가 끝난 뒤에는 경보를 낸다 (봐주기가 영구적이면 안 된다)', () => {
  const d = {
    sessions: [{ sessionId: 'a', shortId: 'a', title: 'ChatTest 실행',
      watch: { on: true, verdict: { alive: false, waiting: false, why: '감시를 켠 지 60분이 지났는데 첫 기록이 없다' } },
      restart: {}, tracker: {} }],
    tasks: {}, locks: {}, totals: { runKnown: true },
  }
  const hit = currentAlerts(d).find((x) => x.code === '감시끊김')
  assert.ok(hit, '대기 창이 끝나면 알려야 한다')
  assert.equal(hit.level, 'critical')
})
