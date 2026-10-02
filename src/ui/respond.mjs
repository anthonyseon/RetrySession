/**
 * respond.mjs — server.mjs 의 응답·본문 도우미.
 *
 * 왜 나왔나 (2026-10-02): «종료» 경로(/api/shutdown)를 넣자 server.mjs 가 400줄을 넘었다.
 *   경로 처리 구역은 시험이 server.mjs 본문에서 직접 찾으므로 그 자리에 둬야 한다 —
 *   그래서 구역이 아닌 도우미를 뺐다. 상태가 없는 잎이다(요청·응답만 다룬다).
 */
import { readFileSync, existsSync } from 'node:fs'

export const json = (res, code, obj) => {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

export const files = (res, path, type) => {
  if (!existsSync(path)) return json(res, 404, { error: `없음: ${path}` })
  const body = readFileSync(path)
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': body.length })
  res.end(body)
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''
    req.on('data', (d) => {
      s += d
      if (s.length > 1_000_000) reject(new Error('본문이 너무 크다'))
    })
    req.on('end', () => {
      if (!s) return resolve({})
      try { resolve(JSON.parse(s)) } catch (e) { reject(new Error('JSON 이 아니다: ' + e.message)) }
    })
    req.on('error', reject)
  })
}
