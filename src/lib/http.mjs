/**
 * http.mjs — "이 요청을 받아도 되는가"를 판정한다. 순수 함수만 둔다.
 *
 * 🔴 왜 서버에서 떼어냈나
 *   이 화면은 `claude --resume` 을 띄울 수 있다 — 토큰을 쓰고 파일을 고친다.
 *   그 문을 지키는 판정이 서버 안에 묻혀 있으면 시험할 수 없고, 시험할 수 없는
 *   보안 판정은 언젠가 조용히 틀린다. 실제로 한 번 틀려 있었다(아래).
 */

/**
 * 요청이 이 PC 에서 왔는가.
 * 바인드가 127.0.0.1 이어도 Host 헤더를 한 번 더 본다 — DNS 리바인딩 방어.
 */
export function isLocal({ remoteAddress, host }) {
  const ra = remoteAddress || ''
  if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) return false
  const h = String(host || '').split(':')[0]
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
}

/** 이 서버가 자기 출처라고 인정하는 것들 */
export const allowedOrigins = (host, port) => new Set([
  `http://${host}:${port}`,
  `http://localhost:${port}`,
])

/**
 * 🔴 다른 웹사이트가 이 API 를 부리지 못하게 한다 (CSRF).
 *
 *   **실측 결함 (2026-09-21)** — 고치기 전에는 이 요청이 그대로 통과했다:
 *     curl -X POST http://127.0.0.1:7345/api/rearm \
 *          -H 'Origin: https://evil.example' -H 'Content-Type: text/plain' ...
 *     -> HTTP 200 {"ok":true}
 *
 *   이건 이론이 아니다. 위 요청은 **아무 웹페이지나 만들 수 있는 모양**이다.
 *   `<form enctype="text/plain">` 과 `fetch(..., {mode:'no-cors'})` 는 CORS 사전확인
 *   없이 그대로 나간다(사전확인은 content-type 이 json 일 때나 붙는다).
 *   그래서 사용자가 어떤 페이지를 열어보기만 해도 그 페이지가
 *     · `/api/run {"kind":"resume"}` 로 내 계정의 토큰을 쓰고 내 파일을 고치게 하고
 *     · `/api/targets {"감시":false}` 로 감시를 조용히 끌 수
 *   있었다. 응답을 못 읽어도 상관없다 — 공격은 부작용 자체다.
 *
 *   127.0.0.1 바인드도 Host 검사도 이걸 막지 못한다. 공격 페이지는 실제로
 *   127.0.0.1 로 보내므로 둘 다 통과한다. 구별해주는 것은 Origin 뿐이다.
 *
 *   브라우저는 교차 출처 요청에 Origin 을 반드시 붙이고, 페이지가 이를 끌 수 없다.
 *   curl·PowerShell 은 붙이지 않는데 그쪽은 이미 이 PC 에서 도는 것이라 막을 대상이
 *   아니다. 그래서 "Origin 이 있으면 내 출처여야 한다"로 충분하고, 없으면 통과다.
 */
export function originOk(origin, host, port) {
  if (origin === undefined || origin === null || origin === '') return true  // 브라우저가 아니다
  if (origin === 'null') return false  // 샌드박스 iframe·data: — 출처를 숨긴 것이므로 거절한다
  return allowedOrigins(host, port).has(origin)
}
