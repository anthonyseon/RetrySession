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
import { spawn, spawnSync } from 'node:child_process'
import { RS_HOME } from '../lib/config.mjs'
import { fullStatus, trayStatus, tail } from '../lib/status.mjs'
import { setMany, removeTarget, statePaths, isSessionId } from '../lib/targets.mjs'
import { loadRunState, saveRunState, rearm } from '../lib/guard.mjs'
import { localStamp } from '../lib/stamp.mjs'
import { singleInstance } from '../lib/single.mjs'
import { isLocal, originOk } from '../lib/http.mjs'
import { runNow, detail } from './actions.mjs'
import { pcState, clearCache, validateValue } from '../lib/pc.mjs'
import { usageReport } from '../lib/usage.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const PORT = Number((argv.indexOf('--port') >= 0 ? argv[argv.indexOf('--port') + 1] : null) || process.env.RS_UI_PORT || 7345)
const HOST = '127.0.0.1'
/** 이 프로세스가 뜬 시각. 화면은 이 값이 바뀌면 자기를 다시 읽는다(/api/ping 참조) */
const bootEpochValue = Date.now()

/**
 * 🔴 서버도 하나만 돈다.
 *   포트 충돌로도 막히기는 하지만, 그때는 EADDRINUSE 로 죽어 작업 이력이 실패로
 *   남고 이유도 불친절하다. 락을 먼저 보면 "이미 돌고 있다"를 정확히 말하고
 *   exit 0 으로 조용히 끝낼 수 있다. 서버는 오래 사니 pid 가 죽었을 때만 회수한다.
 */
singleInstance('ui', { staleMin: 24 * 60 })

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

const files = (res, path, type) => {
  if (!existsSync(path)) return json(res, 404, { error: `없음: ${path}` })
  const body = readFileSync(path)
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': body.length })
  res.end(body)
}

function readBody(req) {
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

/* 접근 판정은 lib/http.mjs 의 순수 함수다 — 왜 그렇게 막는지는 거기에 적혀 있다 */
const isLocalRequest = (req) => isLocal({ remoteAddress: req.socket.remoteAddress, host: req.headers.host })
const originPasses = (req) => originOk(req.headers.origin, HOST, PORT)

/* ── 라우팅 ──────────────────────────────────────────────────── */

const server = createServer(async (req, res) => {
  if (!isLocalRequest(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('RetrySession UI 는 로컬(127.0.0.1) 에서만 쓴다.\n')
  }
  if (!originPasses(req)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    return res.end('다른 사이트에서 온 요청이다 — 거절한다 (CSRF).\n')
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const p = url.pathname

  try {
    /* 정적 */
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return files(res, join(HERE, 'index.html'), 'text/html; charset=utf-8')

    /**
     * 화면 스크립트. app.js 가 common/summary/list/detail 을 import 하므로
     * 한 파일만 열어주면 안 된다.
     *
     * 🔴 이름 규칙으로 막는다 — 슬래시·점·상위 경로가 들어갈 수 없는 정규식이다.
     *   `join(HERE, p.slice(1))` 에 임의 문자열을 넘기면 `../../` 로 저장소 바깥
     *   파일을 읽어낼 수 있다. 화이트리스트 성격의 패턴만 통과시킨다.
     */
    if (req.method === 'GET' && /^\/[a-z][a-z0-9-]{0,30}\.js$/.test(p)) {
      return files(res, join(HERE, p.slice(1)), 'text/javascript; charset=utf-8')
    }

    /**
     * 스타일. index.html 이 400줄을 넘어 CSS 를 app.css 로 뺐다.
     *
     * 🔴 content-type 이 text/css 여야 한다. 브라우저는 MIME 이 틀린 스타일시트를
     *   **조용히 무시한다** — 화면이 무늬 없이 뜨는데 오류는 아무 데도 안 남는다.
     */
    if (req.method === 'GET' && /^\/[a-z][a-z0-9-]{0,30}\.css$/.test(p)) {
      return files(res, join(HERE, p.slice(1)), 'text/css; charset=utf-8')
    }

    /**
     * 🔴 살아있음 확인은 여기로 한다 — 값싸야 한다.
     *
     * 실측 사고: 상태 점검이 /api/tray 를 4초 타임아웃으로 불렀는데, 캐시가 식었을 때
     * 그 응답이 11.3초 걸려서(웜 0.65~3.3초) **멀쩡한 서버를 "응답 없음"으로 보고**했다.
     * 살아있음 판정이 무거운 집계에 얹혀 있으면, 느린 것과 죽은 것을 구별하지 못한다.
     * 이 엔드포인트는 아무것도 계산하지 않는다.
     */
    // 🔴 키는 ASCII 다 — /api/tray 와 같은 이유로 ASCII 스크립트(status.ps1)가 읽는다
    if (req.method === 'GET' && p === '/api/ping') {
      return json(res, 200, {
        ok: true, at: localStamp(), pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        /**
         * 🔴 이 서버가 **언제 뜬 것인지**. 화면이 이 값을 보고 자기를 다시 읽는다.
         *
         *   실측 (2026-09-22): `start.ps1 -Restart` 로 서버는 새 코드를 들고 떴는데
         *   이미 열려 있던 창은 **옛 모듈을 그대로** 들고 폴링을 계속했다. 고친
         *   결함이 화면에서는 그대로 남아 있고 아무도 경고하지 않는다 —
         *   이 저장소를 만드는 동안 세 번 걸린 함정이다.
         */
        // 🔴 키 이름이 ASCII 다. 이 응답은 ANSI(cp949)로 읽히는 .ps1 들이 본다 —
        //   한글 키를 넣으면 그쪽에서 깨진다(시험이 이것을 잡는다).
        bootEpoch: bootEpochValue,
      })
    }

    /* 상태 */
    if (req.method === 'GET' && p === '/api/status') return json(res, 200, fullStatus())

    /**
     * 사용량 상세. **상태 조회와 따로 둔다** — `/usage` 호출이 몇 초 걸릴 수 있어서
     * `/api/status`(3초마다 폴링)에 끼우면 화면 전체가 그만큼 느려진다.
     * `?fresh=1` 은 화면의 `갱신` 단추가 쓴다 — 캐시를 건너뛰고 지금 값을 읽는다.
     */
    if (req.method === 'GET' && p === '/api/usage') {
      const fresh = new URL(req.url, 'http://x').searchParams.get('fresh') === '1'
      // 🔴 공식 사용률은 그물을 타므로 기다린다(await) — 안 기다리면 화면이 빈 약속을 받는다
      return json(res, 200, await usageReport({ fresh }))
    }

    // 트레이 전용 — 키가 전부 ASCII 다 (scripts/tray.ps1 이 ANSI 로 읽히기 때문)
    if (req.method === 'GET' && p === '/api/tray') return json(res, 200, trayStatus())

    if (req.method === 'GET' && p.startsWith('/api/session/')) {
      const id = decodeURIComponent(p.slice('/api/session/'.length))
      if (!id) return json(res, 400, { error: 'sessionId 가 없다' })
      // 🔴 이 값은 경로가 된다. 형태를 확인하고 들여보낸다 (lib/targets.mjs 의 세션id인가 참조)
      if (!isSessionId(id)) return json(res, 400, { error: 'sessionId 형태가 아니다' })
      const turns = Math.min(200, Number(url.searchParams.get('turns')) || 40)
      return json(res, 200, detail(id, { turns }))
    }

    /* 변경 */
    if (req.method === 'POST' && p === '/api/targets') {
      const b = await readBody(req)
      const ids = Array.isArray(b.sessionIds) ? b.sessionIds : []
      if (!ids.length) return json(res, 400, { error: 'sessionIds 가 비었다' })
      // 하나라도 형태가 아니면 전부 거절한다 — 일부만 적용하면 무엇이 켜졌는지 알 수 없다
      const bad = ids.filter((id) => !isSessionId(id))
      if (bad.length) return json(res, 400, { error: 'sessionId 형태가 아니다', badValues: bad.slice(0, 5) })

      /**
       * 🔴 ASCII 별칭을 함께 받는다 (`watch` / `resume` / `instruction`).
       *   이 API 는 돈을 쓰는 재시작을 켜고 끈다 — 셸에서 확실하게 호출할 수 있어야 한다.
       *   실측: Git Bash 에서 `curl -d '{"감시":false}'` 는 한글 키가 깨져 조용히 무시됐다.
       *   브라우저는 UTF-8 을 제대로 보내므로 화면은 무사했지만, 그런 차이를 남겨두면
       *   나중에 스크립트로 껐다고 믿는 상태가 만들어진다.
       */
      const boolOf = (...keys) => { for (const k of keys) if (typeof b[k] === 'boolean') return b[k]; return undefined }
      const strOf = (...keys) => { for (const k of keys) if (typeof b[k] === 'string') return b[k]; return undefined }

      const patch = {}
      const w = boolOf('watch', '감시')
      const r = boolOf('restart', 'resume', '재시작')
      /**
       * 🔴 `resumePrompt` 를 **맨 앞에** 둔다 — 화면이 보내는 이름이다.
       *
       *   실측 결함 (2026-09-22): 받는 목록이 `재개지시`·`instruction` 뿐이었는데
       *   화면은 저장된 필드 이름 그대로 `resumePrompt` 를 보냈다. 그래서 상세의
       *   [재개지시 저장]이 늘 400 "바꿀 것이 없다" 로 떨어졌다. 추적기가 없는
       *   세션은 재개지시가 **유일한 재개 지점**이라, 이 단추가 죽어 있으면
       *   재시작을 켜 둬도 영원히 돌지 않는다.
       *   이름을 영어로 옮길 때 문자열로 들고 다니는 키를 놓친 것이다(CLAUDE.md 2-2).
       */
      const ins = strOf('resumePrompt', 'instruction', '재개지시')
      if (w !== undefined) patch.watch = w
      if (r !== undefined) patch.restart = r
      if (ins !== undefined) patch.resumePrompt = ins.trim() || null

      if (!Object.keys(patch).length) {
        return json(res, 400, {
          error: '바꿀 것이 없다',
          acceptedKeys: ['watch | 감시 (boolean)', 'restart | resume | 재시작 (boolean)', 'resumePrompt | instruction | 재개지시 (string)'],
          gotKeys: Object.keys(b),
        })
      }
      const result = setMany(ids, patch, b.meta || {})

      /**
       * 🔴 감시를 켰으면 **지금 한 번 기록한다.**
       *
       *   실측 사건 (2026-09-21): 감시를 켠 38초 전에 5분 주기 하트비트가 막
       *   지나가서, 다음 회차까지 기록이 없었다. 판정은 그 사이를 "끊김"으로 읽고
       *   치명 경보를 띄웠다(그쪽은 guard.mjs 에서 대기로 고쳤다).
       *   하지만 진짜 해결은 **기다림을 없애는 것**이다 — 감시를 켰다는 것은
       *   "지금부터 보라"는 뜻이고, 5분을 비워두는 것은 그 요청에 못 미친다.
       *
       *   떼어내서 띄우므로 응답을 붙잡지 않는다. 한 회차가 모든 대상을 기록하니
       *   여러 세션을 한꺼번에 켜도 한 번이면 되고, 예약 회차와 겹쳐도
       *   단일 실행 락이 받아낸다(중복은 exit 0).
       */
      if (patch.watch === true) {
        try { runNow('heartbeat') } catch { /* 기록 실패가 켜기를 막지 않는다 */ }
      }

      return json(res, 200, { ok: true, result })
    }

    /**
     * 🔴 걸러낸 것을 **말없이 버리지 않는다.**
     *
     *   실측 (2026-09-22, 전수 점검): 잘못된 sessionId 를 보내면 `{ok:true, 지움:0}` 을
     *   돌려줬다. 부른 쪽은 성공으로 읽는데 실제로는 아무 일도 없었다 — 같은 입력에
     *   /api/targets 는 400 을 준다. 같은 잘못에 다른 답을 주면 어느 쪽이 맞는지
     *   알 수 없고, "해제했다"고 믿은 채로 차단이 남는다.
     */
    const checkIds = (b) => {
      const all = Array.isArray(b.sessionIds) ? b.sessionIds : []
      const bad = all.filter((x) => !isSessionId(x))
      return { ids: all.filter(isSessionId), bad }
    }

    if (req.method === 'POST' && p === '/api/targets/remove') {
      const b = await readBody(req)
      const { ids, bad } = checkIds(b)
      if (bad.length) return json(res, 400, { error: 'sessionId 형태가 아니다', detail: bad.map(String) })
      for (const id of ids) removeTarget(id)
      return json(res, 200, { ok: true, removed: ids.length })
    }

    if (req.method === 'POST' && p === '/api/rearm') {
      const b = await readBody(req)
      const { ids, bad } = checkIds(b)
      if (bad.length) return json(res, 400, { error: 'sessionId 형태가 아니다', detail: bad.map(String) })
      for (const id of ids) {
        const P = statePaths(id)
        saveRunState(P.resumeState, rearm(loadRunState(P.resumeState)))
      }
      return json(res, 200, { ok: true, lift: ids.length })
    }

    /**
     * PC 전원 설정을 바꾼다.
     *
     * 🔴 왜 화면에서도 할 수 있어야 하나
     *   잠든 PC 는 아무것도 돌리지 않는다 — 이 도구가 성립하는 전제다. 그런데
     *   고치는 법이 CLI 에만 있으면, 화면만 보는 사람은 "감시 정상"을 보면서
     *   자리를 비우는 순간 멎는 PC 를 쓰게 된다.
     *
     * 🔴 남의 PC 설정을 바꾸는 일이므로, 여기서도 CLI 와 **같은 안전장치**를 거친다:
     *   바꾸기 전 값을 저장하고(되돌릴 수 없으면 바꾸지 않는다), 바꾼 뒤 다시 읽어
     *   확인하고, 배터리 설정은 건드리지 않는다. 그 전부가 src/pc.mjs 안에 있으므로
     *   여기서는 **그 스크립트를 부르기만** 한다 — 규칙을 두 벌로 만들지 않는다.
     */
    if (req.method === 'POST' && p === '/api/pc') {
      const b = await readBody(req)

      /**
       * 셋 중 하나다:
       *   apply   — 권장값으로 (AC 만)
       *   restore — 보관된 값으로 되돌리기
       *   set     — **사람이 고른 값 그대로** (배터리도 가능 — 직접 고른 것이므로)
       */
      let args2 = null
      if (b.action === 'restore') args2 = ['--restore']
      else if (b.action === 'apply') args2 = ['--apply']
      else if (b.action === 'set') {
        // 🔴 브라우저에서 온 값이다. 서버에서 다시 검증한다 —
        //   화면이 막아준다고 믿으면 그 화면을 거치지 않는 요청에 뚫린다.
        const values = b.values && typeof b.values === 'object' ? b.values : {}
        const good = [], bad = []
        for (const [k, v] of Object.entries(values)) {
          const r = validateValue(k, v)
          if (r.ok) good.push(`${k}=${r.value}`)
          else bad.push(`${k}: ${r.why}`)
        }
        if (bad.length) return json(res, 400, { error: '쓸 수 없는 값이다', detail: bad })
        if (!good.length) return json(res, 400, { error: 'values 가 비었다' })
        args2 = ['--set', ...good]
      }
      if (!args2) return json(res, 400, { error: "action 은 'apply' · 'restore' · 'set' 중 하나여야 한다" })

      const r = spawnSync(process.execPath, [join(RS_HOME, 'src', 'pc.mjs'), ...args2], {
        cwd: RS_HOME, encoding: 'utf8', timeout: 60000, windowsHide: true,
      })
      // 바꿨으면 캐시가 거짓말을 한다 — 다음 조회가 새로 읽게 한다
      clearCache()
      const output = `${r.stdout || ''}${r.stderr || ''}`.trim()
      return json(res, 200, { ok: r.status === 0, actions: b.action, exit: r.status, output, nowMs: pcState({ force: true }) })
    }

    if (req.method === 'POST' && p === '/api/run') {
      const b = await readBody(req)
      const kind = b.kind === 'resume' ? 'resume' : 'heartbeat'
      // 🔴 이 값은 자식 프로세스의 인자가 된다. 형태를 확인하지 않으면 `--session a` 처럼
      //   앞글자만 주어 의도하지 않은 세션까지 걸리게 할 수 있다(대상들() 은 앞자리로 맞춘다).
      const sid = b.sessionId || null
      if (sid && !isSessionId(sid)) return json(res, 400, { error: 'sessionId 형태가 아니다' })
      return json(res, 200, runNow(kind, sid))
    }

    return json(res, 404, { error: `없는 경로: ${p}` })
  } catch (e) {
    /**
     * 🔴 **누구의 잘못인지** 상태 코드로 구별한다.
     *
     *   보낸 쪽이 깨진 JSON 을 줬는데 500 으로 답하면 "서버가 고장났다"는 뜻이 된다.
     *   그러면 사람은 서버를 들여다보고, 진짜 원인(보낸 본문)은 끝까지 안 보인다.
     *   이 저장소가 반복해서 고쳐 온 것과 같은 부류다 — 고칠 수 있는 이유를 감추지 않는다.
     */
    const clientFault = /JSON 이 아니다|본문이 너무 크다/.test(e.message || '')
    return json(res, clientFault ? 400 : 500, { error: e.message })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`RetrySession UI — http://${HOST}:${PORT}`)
  console.log(`  로컬 전용이다. 이 화면은 재시작(claude --resume)을 띄울 수 있다.`)

  /**
   * 캐시를 미리 데운다.
   *
   * 실측: 캐시가 식은 첫 요청은 11.3초 걸렸다(schtasks 조회 ~4초, CLI 호출 ~2초,
   * 프로세스 열거 ~0.7초, 트랜스크립트 초회 스캔). 창을 처음 열었을 때 그 시간을
   * 사람이 기다리게 되고, 짧은 타임아웃을 쓰는 점검은 죽었다고 오판한다.
   * 기동 직후 한 번 돌려두면 첫 요청이 웜 경로를 탄다. 실패해도 무시한다 —
   * 데우기가 안 됐다고 서버가 못 뜰 이유는 없다.
   */
  setTimeout(() => {
    try { fullStatus() } catch { /* 첫 요청이 대신 계산한다 */ }
  }, 100)
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`✖ 포트 ${PORT} 가 이미 쓰이고 있다 — 이미 떠 있거나 다른 프로그램이 쓴다.`)
    console.error(`  확인: http://${HOST}:${PORT}  ·  다른 포트: --port 7346`)
    process.exit(2)
  }
  throw e
})
