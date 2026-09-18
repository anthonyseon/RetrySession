/**
 * server.mjs — 상태 화면을 띄우는 의존성 없는 HTTP 서버.
 *
 * 🔴 127.0.0.1 에만 묶는다.
 *   이 화면은 `claude --resume` 을 띄울 수 있다 — 즉 **토큰을 쓰고 파일을 고칠 수 있다.**
 *   외부에 열면 남이 내 계정으로 일을 시킬 수 있다. 바인드 주소를 바꾸지 마라.
 *   추가로 Host 헤더가 localhost 계열인지 한 번 더 본다(DNS 리바인딩 방어).
 *
 * 왜 의존성이 없나
 *   이 도구는 "세션이 죽었을 때 살아 있어야 하는" 감시 장치다. npm install 이 필요한
 *   도구는 그 순간에 못 뜬다. node 만 있으면 도는 상태를 유지한다.
 *
 * 사용법
 *   node src/ui/server.mjs            기본 7345 포트
 *   node src/ui/server.mjs --port 8080
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { RS_HOME } from '../lib/config.mjs'
import { fullStatus, tail } from '../lib/status.mjs'
import { sessionDetail } from '../lib/detail.mjs'
import { loadTargets, setMany, removeTarget, statePaths, resolveRepo, trackerPath } from '../lib/targets.mjs'
import { loadRunState, saveRunState, budgetVerdict, rearm } from '../lib/guard.mjs'
import { readTracker } from '../lib/tracker.mjs'
import { localStamp } from '../lib/stamp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const PORT = Number((argv.indexOf('--port') >= 0 ? argv[argv.indexOf('--port') + 1] : null) || process.env.RS_UI_PORT || 7345)
const HOST = '127.0.0.1'

/* ── 응답 도우미 ─────────────────────────────────────────────── */

const json = (res, code, obj) => {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

const 파일 = (res, path, type) => {
  if (!existsSync(path)) return json(res, 404, { 오류: `없음: ${path}` })
  const body = readFileSync(path)
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': body.length })
  res.end(body)
}

function 본문읽기(req) {
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

/** 로컬 요청만 받는다 */
function 로컬인가(req) {
  const ra = req.socket.remoteAddress || ''
  if (!(ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1')) return false
  const host = (req.headers.host || '').split(':')[0]
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1'
}

/* ── 지금 실행 (하트비트·재시작 수동 발동) ───────────────────── */

/**
 * 🔴 떼어내서 띄운다(detached). 재시작은 최대 30분 돌 수 있으므로 HTTP 응답을
 *   붙잡고 있으면 화면이 멈춘 것처럼 보인다. 진행은 로그로 본다.
 */
function 지금실행(kind, sessionId) {
  const script = kind === 'resume' ? 'src/resume.mjs' : 'src/heartbeat.mjs'
  const args = [join(RS_HOME, script)]
  if (kind === 'resume' && sessionId) args.push('--session', sessionId)
  const child = spawn(process.execPath, args, {
    cwd: RS_HOME, detached: true, stdio: 'ignore', windowsHide: true,
  })
  child.unref()
  return { 시작됨: true, kind, pid: child.pid, at: localStamp() }
}

/* ── 세션 상세 (감시·재시작 상태와 로그를 함께) ──────────────── */

function 상세(sessionId, { turns = 40 } = {}) {
  const d = sessionDetail(sessionId, { turns })
  const 등록 = loadTargets()
  const 대상 = 등록.targets[sessionId] || null

  let 감시로그 = [], 재시작로그 = [], 재시작 = null, 하트비트 = null, 추적기 = null
  if (대상) {
    const P = statePaths(sessionId)
    감시로그 = tail(P.하트비트로그, 60)
    재시작로그 = tail(P.재개로그, 120)
    try { 하트비트 = JSON.parse(readFileSync(P.하트비트, 'utf8')) } catch { 하트비트 = null }

    const 짝 = 대상.주작업cwd || 대상.실행cwd
    const { project } = 짝 ? resolveRepo(짝) : { project: null }
    if (project) {
      const st = loadRunState(P.재개상태)
      const b = budgetVerdict(st, project.재개)
      재시작 = {
        상태: st, 예산: b, 설정: project.재개, 저장소id: project.id,
        추적기경로: project.tracker || null,
      }
      // 상세 화면에서 재개 지점을 그대로 보여준다
      const tp = trackerPath(project)
      if (tp) 추적기 = readTracker(tp)
    }
  }
  return { ...d, 대상, 하트비트, 감시로그, 재시작로그, 재시작, 추적기 }
}

/* ── 라우팅 ──────────────────────────────────────────────────── */

const server = createServer(async (req, res) => {
  if (!로컬인가(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('RetrySession UI 는 로컬(127.0.0.1) 에서만 쓴다.\n')
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const p = url.pathname

  try {
    /* 정적 */
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return 파일(res, join(HERE, 'index.html'), 'text/html; charset=utf-8')
    if (req.method === 'GET' && p === '/app.js') return 파일(res, join(HERE, 'app.js'), 'text/javascript; charset=utf-8')

    /* 상태 */
    if (req.method === 'GET' && p === '/api/status') return json(res, 200, fullStatus())

    if (req.method === 'GET' && p.startsWith('/api/session/')) {
      const id = decodeURIComponent(p.slice('/api/session/'.length))
      if (!id) return json(res, 400, { 오류: 'sessionId 가 없다' })
      const turns = Math.min(200, Number(url.searchParams.get('turns')) || 40)
      return json(res, 200, 상세(id, { turns }))
    }

    /* 변경 */
    if (req.method === 'POST' && p === '/api/targets') {
      const b = await 본문읽기(req)
      const ids = Array.isArray(b.sessionIds) ? b.sessionIds : []
      if (!ids.length) return json(res, 400, { 오류: 'sessionIds 가 비었다' })

      /**
       * 🔴 ASCII 별칭을 함께 받는다 (`watch` / `resume` / `instruction`).
       *   이 API 는 돈을 쓰는 재시작을 켜고 끈다 — 셸에서 확실하게 호출할 수 있어야 한다.
       *   실측: Git Bash 에서 `curl -d '{"감시":false}'` 는 한글 키가 깨져 조용히 무시됐다.
       *   브라우저는 UTF-8 을 제대로 보내므로 화면은 무사했지만, 그런 차이를 남겨두면
       *   나중에 스크립트로 껐다고 믿는 상태가 만들어진다.
       */
      const 불리언 = (...keys) => { for (const k of keys) if (typeof b[k] === 'boolean') return b[k]; return undefined }
      const 문자열 = (...keys) => { for (const k of keys) if (typeof b[k] === 'string') return b[k]; return undefined }

      const patch = {}
      const w = 불리언('감시', 'watch')
      const r = 불리언('재시작', 'resume')
      const ins = 문자열('재개지시', 'instruction')
      if (w !== undefined) patch.감시 = w
      if (r !== undefined) patch.재시작 = r
      if (ins !== undefined) patch.재개지시 = ins.trim() || null

      if (!Object.keys(patch).length) {
        return json(res, 400, {
          오류: '바꿀 것이 없다',
          받는키: ['감시 | watch (boolean)', '재시작 | resume (boolean)', '재개지시 | instruction (string)'],
          받은키: Object.keys(b),
        })
      }
      const 결과 = setMany(ids, patch, b.meta || {})
      return json(res, 200, { ok: true, 결과 })
    }

    if (req.method === 'POST' && p === '/api/targets/remove') {
      const b = await 본문읽기(req)
      for (const id of b.sessionIds || []) removeTarget(id)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && p === '/api/rearm') {
      const b = await 본문읽기(req)
      for (const id of b.sessionIds || []) {
        const P = statePaths(id)
        saveRunState(P.재개상태, rearm(loadRunState(P.재개상태)))
      }
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST' && p === '/api/run') {
      const b = await 본문읽기(req)
      const kind = b.kind === 'resume' ? 'resume' : 'heartbeat'
      return json(res, 200, 지금실행(kind, b.sessionId || null))
    }

    return json(res, 404, { 오류: `없는 경로: ${p}` })
  } catch (e) {
    return json(res, 500, { 오류: e.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`RetrySession UI — http://${HOST}:${PORT}`)
  console.log(`  로컬 전용이다. 이 화면은 재시작(claude --resume)을 띄울 수 있다.`)
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`✖ 포트 ${PORT} 가 이미 쓰이고 있다 — 이미 떠 있거나 다른 프로그램이 쓴다.`)
    console.error(`  확인: http://${HOST}:${PORT}  ·  다른 포트: --port 7346`)
    process.exit(2)
  }
  throw e
})
