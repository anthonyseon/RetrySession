/**
 * pricing.mjs — 토큰 수를 비용으로 환산한다.
 *
 * 왜 직접 계산하는가
 *   세션 트랜스크립트의 assistant 엔트리에는 토큰 수는 있지만 비용이 없다
 *   (`claude -p` 의 result 엔트리에만 total_cost_usd 가 붙는다).
 *   사용량 화면에서 비용을 보여주려면 단가를 곱해야 한다.
 *
 * 🔴 단가표는 config/pricing.json 이 정본이고 실측으로 검증했다.
 *   배수를 코드에 박지 않는다 — 단가는 바뀐다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME } from './config.mjs'

let _표 = null

export function 단가표() {
  if (_표) return _표
  _표 = JSON.parse(readFileSync(join(RS_HOME, 'config', 'pricing.json'), 'utf8'))
  return _표
}

/**
 * 모델 id 를 단가표 키로 정규화한다.
 * CLI 는 컨텍스트 창을 접미사로 붙인다 — `claude-opus-5[1m]` (실측).
 */
export function normalizeModel(id) {
  return String(id || '').replace(/\[.*?\]$/, '').trim()
}

export const 빈토큰 = () => ({ 입력: 0, 캐시쓰기1h: 0, 캐시쓰기5m: 0, 캐시읽기: 0, 출력: 0, 사고: 0 })

/**
 * 모델이 아닌 것들. 단가표에 없다고 "추정"으로 표시하면 안 된다.
 *
 * 🔴 실측 (2026-09-21): 트랜스크립트에 `<synthetic>` 모델 엔트리가 있다. 내용은
 *   `"You've hit your session limit · resets 1:30pm"` 같은 **로컬 알림**이고
 *   usage 는 전부 0 이다(입력·출력·캐시 모두). 모델 호출이 아니다.
 *   그런데 단가표에 없으니 `추정: true` 가 되어, 7개 세션 중 2개가 "추정 단가 포함"
 *   으로 표시됐다 — 비용은 $0.00 인데 **숫자를 의심하게 만드는 거짓 경고**다.
 *   모르는 모델을 추정으로 표시하는 것은 옳다(0 으로 감추면 안 된다). 하지만
 *   애초에 모델이 아닌 것은 그 판정에서 빼야 한다.
 */
const 모델아님 = new Set(['<synthetic>'])
export const isBillable = (id) => !모델아님.has(normalizeModel(id))

/** 토큰 두 묶음을 합친다 (순수) */
export function 토큰합(a, b) {
  const out = { ...빈토큰() }
  for (const k of Object.keys(out)) out[k] = (a?.[k] || 0) + (b?.[k] || 0)
  return out
}

/**
 * 한 모델의 토큰 묶음 → USD. 순수 함수.
 * @returns {{usd:number, 추정:boolean}} 추정=단가표에 없는 모델이라 기본 단가를 썼다
 */
export function modelCost(modelId, 토큰, 표 = 단가표()) {
  const key = normalizeModel(modelId)

  // 모델이 아닌 엔트리(`<synthetic>` 등)는 비용도 0 이고 추정도 아니다.
  // 토큰이 0 이 아니면 우리가 잘못 안 것이므로 추정으로 되돌린다 — 조용히 감추지 않는다.
  if (!isBillable(key)) {
    const 합 = (토큰.입력 || 0) + (토큰.캐시쓰기1h || 0) + (토큰.캐시쓰기5m || 0) +
      (토큰.캐시읽기 || 0) + (토큰.출력 || 0)
    if (합 === 0) return { usd: 0, 추정: false }
  }

  const m = 표.모델[key]
  const r = m || 표.기본
  const b = 표.배수

  const usd =
    (토큰.입력 || 0) * r.입력 +
    (토큰.캐시쓰기1h || 0) * r.입력 * b.캐시쓰기_1h +
    (토큰.캐시쓰기5m || 0) * r.입력 * b.캐시쓰기_5m +
    (토큰.캐시읽기 || 0) * r.입력 * b.캐시읽기 +
    (토큰.출력 || 0) * r.출력

  /**
   * 단가는 $/1M 이므로 1e6 으로 나눈다.
   *
   * 🔴 여기서 반올림하지 않는다. 중간에 6자리로 자르면 실측 표본과 5e-7 어긋났고
   *   (CLI 보고 0.0408015 vs 우리 0.040801), 그 오차가 수천 엔트리에 누적된다.
   *   회계는 끝까지 정확히 하고 **화면에서만** 반올림한다.
   */
  return { usd: usd / 1e6, 추정: !m }
}

/**
 * `{모델id: 토큰}` 묶음 전체의 비용.
 * @returns {{usd:number, 추정포함:boolean, 모델별:object}}
 */
export function totalCost(모델별, 표 = 단가표()) {
  let usd = 0, 추정포함 = false
  const out = {}
  for (const [id, tok] of Object.entries(모델별 || {})) {
    const c = modelCost(id, tok, 표)
    out[id] = { ...tok, usd: c.usd, 추정: c.추정 }
    usd += c.usd
    if (c.추정) 추정포함 = true
  }
  return { usd: +usd.toFixed(4), 추정포함, 모델별: out }
}

/** 큰 수를 읽기 쉽게 — 12.9K / 1.3M */
export function compact(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (Math.abs(v) >= 1e4) return (v / 1e3).toFixed(1) + 'K'
  return v.toLocaleString('en-US')
}
