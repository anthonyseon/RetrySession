/**
 * pricing.test.mjs — 비용 환산을 **실측 표본으로** 고정한다.
 *
 * 표본은 `claude -p --output-format json` 이 스스로 보고한 total_cost_usd 다.
 * 우리 계산이 그 값과 어긋나면 화면의 금액이 거짓이 된다 — 그래서 오차 0 을 요구한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelCost, totalCost, normalizeModel, 단가표, 빈토큰, 토큰합, compact, isBillable } from '../src/lib/pricing.mjs'

/** CLI 가 보고한 값과의 차이가 부동소수 오차 안인가 */
const 일치 = (실제, 보고값) =>
  assert.ok(Math.abs(실제 - 보고값) < 1e-9,
    `보고값 ${보고값} 와 어긋난다: ${실제} (차이 ${Math.abs(실제 - 보고값)})`)

test('🔴 실측 표본1 — cacheWrite1h 위주 (claude-opus-5, 보고값 $0.21362)', () => {
  const t = { ...빈토큰(), 입력: 2, 캐시쓰기1h: 21351, 출력: 4 }
  일치(modelCost('claude-opus-5', t).usd, 0.21362)
})

test('🔴 실측 표본2 — cacheRead 포함 (claude-opus-5, 보고값 $0.0408015)', () => {
  const t = { ...빈토큰(), 입력: 2, 캐시쓰기1h: 3160, 캐시읽기: 18183, 출력: 4 }
  일치(modelCost('claude-opus-5', t).usd, 0.0408015)
})

test('🔴 중간 반올림을 하지 않는다 — 누적 오차가 생긴다', () => {
  // 6자리로 자르면 이 값은 0.040801 이 되어 5e-7 어긋난다
  const t = { ...빈토큰(), 입력: 2, 캐시쓰기1h: 3160, 캐시읽기: 18183, 출력: 4 }
  const usd = modelCost('claude-opus-5', t).usd
  assert.notEqual(usd, 0.040801, '반올림된 값이면 정확도를 잃은 것이다')
})

test('배수가 단가표에서 온다 — 코드에 박혀 있지 않다', () => {
  const 표 = 단가표()
  assert.equal(표.배수.캐시쓰기_1h, 2)
  assert.equal(표.배수.캐시읽기, 0.1)
  assert.equal(표.모델['claude-opus-5'].입력, 5)
  assert.equal(표.모델['claude-opus-5'].출력, 25)
})

test('캐시읽기는 입력의 1/10 이다', () => {
  const a = modelCost('claude-opus-5', { ...빈토큰(), 입력: 1_000_000 }).usd
  const b = modelCost('claude-opus-5', { ...빈토큰(), 캐시읽기: 1_000_000 }).usd
  assert.equal(a, 5)
  assert.equal(b, 0.5)
})

test('모델별로 단가가 다르다', () => {
  const t = { ...빈토큰(), 입력: 1_000_000 }
  assert.equal(modelCost('claude-sonnet-5', t).usd, 2)
  assert.equal(modelCost('claude-haiku-4-5', t).usd, 1)
  assert.equal(modelCost('claude-fable-5-1', t).usd, 10)
})

test('🔴 모르는 모델은 0 이 아니라 기본 단가로 계산하고 추정으로 표시한다', () => {
  const r = modelCost('claude-미래모델-9', { ...빈토큰(), 입력: 1_000_000 })
  assert.equal(r.추정, true, '추정임을 알려야 한다')
  assert.ok(r.usd > 0, '0 으로 처리하면 비용을 감추는 것이다')
})

test('알려진 모델은 추정이 아니다', () => {
  assert.equal(modelCost('claude-opus-5', 빈토큰()).추정, false)
})

test('normalizeModel — CLI 가 붙이는 컨텍스트 접미사를 떼낸다 (실측: claude-opus-5[1m])', () => {
  assert.equal(normalizeModel('claude-opus-5[1m]'), 'claude-opus-5')
  assert.equal(normalizeModel('claude-opus-5'), 'claude-opus-5')
  assert.equal(normalizeModel(null), '')
})

test('접미사가 붙어도 정가로 계산된다 — 추정으로 떨어지지 않는다', () => {
  const r = modelCost('claude-opus-5[1m]', { ...빈토큰(), 입력: 1_000_000 })
  assert.equal(r.추정, false)
  assert.equal(r.usd, 5)
})

test('totalCost — 여러 모델을 합하고 추정 포함 여부를 알린다', () => {
  const r = totalCost({
    'claude-opus-5': { ...빈토큰(), 입력: 1_000_000 },
    'claude-sonnet-5': { ...빈토큰(), 입력: 1_000_000 },
  })
  assert.equal(r.usd, 7)
  assert.equal(r.추정포함, false)

  const r2 = totalCost({ '이상한모델': { ...빈토큰(), 입력: 1000 } })
  assert.equal(r2.추정포함, true)
})

test('totalCost — 빈 입력은 0', () => {
  assert.equal(totalCost({}).usd, 0)
  assert.equal(totalCost(null).usd, 0)
})

test('토큰합', () => {
  const r = 토큰합({ 입력: 1, 출력: 2 }, { 입력: 10, 캐시읽기: 5 })
  assert.equal(r.입력, 11)
  assert.equal(r.출력, 2)
  assert.equal(r.캐시읽기, 5)
})

test('압축 표기', () => {
  assert.equal(compact(999), '999')
  assert.equal(compact(12_345), '12.3K')
  assert.equal(compact(1_500_000), '1.5M')
  assert.equal(compact(2_000_000_000), '2.0B')
})

/* ── 모델이 아닌 엔트리 ─────────────────────────────────────── */

/**
 * 🔴 실측 (2026-09-21): 트랜스크립트에 `<synthetic>` 엔트리가 있다. 내용은
 *   "You've hit your session limit · resets 1:30pm" 같은 **로컬 알림**이고
 *   usage 는 전부 0 이다. 모델 호출이 아닌데 단가표에 없으니 추정으로 표시됐고,
 *   그래서 7개 세션 중 2개가 "추정 단가 포함"으로 보였다 — 비용은 $0 인데
 *   숫자를 의심하게 만드는 거짓 경고다.
 */
test('🔴 <synthetic> 는 모델이 아니다 — 비용 0, 추정도 아니다', () => {
  const r = modelCost('<synthetic>', 빈토큰())
  assert.equal(r.usd, 0)
  assert.equal(r.추정, false, '모델이 아닌 것을 추정으로 표시하면 거짓 경고가 된다')
})

test('🔴 <synthetic> 에 토큰이 붙어 있으면 추정으로 되돌린다 (조용히 감추지 않는다)', () => {
  // 우리가 잘못 안 경우다. 0 으로 감추면 비용을 숨기는 것이 된다.
  const r = modelCost('<synthetic>', { ...빈토큰(), 출력: 1000 })
  assert.equal(r.추정, true, '토큰이 있으면 계산해야 하고, 단가를 모르면 추정이다')
  assert.ok(r.usd > 0, '토큰이 있으면 비용도 있어야 한다')
})

test('totalCost — <synthetic> 만 있으면 추정포함이 아니다', () => {
  const r = totalCost({ '<synthetic>': 빈토큰() })
  assert.equal(r.usd, 0)
  assert.equal(r.추정포함, false)
})

test('totalCost — 진짜 모르는 모델은 여전히 추정으로 표시한다', () => {
  const r = totalCost({ 'claude-미래-9': { ...빈토큰(), 입력: 1_000_000 } })
  assert.equal(r.추정포함, true, '모르는 모델을 0 으로 감추면 비용을 숨기는 것이다')
  assert.ok(r.usd > 0)
})

test('isBillable — 접미사가 붙어도 가려낸다', () => {
  assert.equal(isBillable('<synthetic>'), false)
  assert.equal(isBillable('claude-opus-5'), true)
  assert.equal(isBillable('claude-opus-5[1m]'), true)
})
