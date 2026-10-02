/**
 * quit.js — 머리말의 «종료» 단추: RetrySession 전부를 끈다(사용자 요청 2026-10-02).
 *
 * 서버의 POST /api/shutdown → scripts/stop-all.ps1 — stop.bat · 트레이 «종료» 와 **같은 스크립트**다.
 * 네 창구가 «멈췄다» 를 같은 뜻으로 말하게 하려고 하나로 모았다.
 *
 * 🔴 확인을 받는다 — 감시가 멈추고, 도는 재시작 회차도 끊긴다. 다시 켜는 길(start.bat)을 함께 말한다.
 * 🔴 끈 뒤에는 서버가 없다. 폴링이 «상태를 읽을 수 없습니다» 치명 경보를 띄우면 사람이 끈 것을
 *   고장이라 부르는 셈이다(CLAUDE.md §2-1 — 사람이 멈췄다 ≠ 실패했다). 그래서 S.stopped 를 세워
 *   폴링을 멈추고(app.js), 신선도 줄이 «종료함» 을 말한다.
 * 🔴 실패를 성공이라 하지 않는다 — post 는 실패해도 본문을 돌려준다(null 은 연결 실패).
 *
 * common.js 만 가져오는 잎이다. 부작용이 없다 — initQuit() 를 불러야 배선된다.
 */
'use strict'
import { $, S, actions } from './common.js'

/** 보내는 중인가 — 두 번 눌러 두 번 보내지 않게 한다 */
let busy = false

const ASK = [
  'RetrySession 을 완전히 종료합니다.',
  '',
  '· 상태 서버 · 트레이 · 5분 감시 · 도는 재시작 회차 · 이 창을 모두 멈춥니다.',
  '· 예약 작업을 꺼 둡니다 — 저절로 다시 켜지지 않습니다(등록은 남습니다).',
  '',
  '다시 켜려면 RetrySession 폴더의 start.bat 을 실행하세요.',
].join('\n')

function setButton(text, disabled) {
  const b = $('#btnQuit')
  if (!b) return
  b.textContent = text
  b.disabled = disabled
}

async function quit() {
  if (busy || S.stopped) return
  if (!confirm(ASK)) return
  busy = true
  setButton('종료하는 중…', true)
  try {
    const r = await actions.post('/api/shutdown', { by: 'ui' })
    if (r?.ok) {
      S.stopped = `■ ${r.at || ''} 종료함 — RetrySession 이 멈췄습니다. 다시 켜려면 start.bat`
      actions.say(`■ 종료했습니다 — ${r.note || '다시 켜려면 start.bat'}`)
      setButton('종료함', true)
      actions.draw()
      return
    }
    actions.say(`✖ 종료하지 못했습니다 — ${r?.error || '서버에 닿지 못했습니다'}`)
    setButton('종료', false)
  } finally {
    busy = false
  }
}

export function initQuit() {
  $('#btnQuit')?.addEventListener('click', quit)
}
