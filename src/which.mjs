/**
 * which.mjs — **어느 claude 를 띄우는가**, 그리고 세션들은 무엇으로 돌았나.
 *
 * 🔴 왜 명령으로 두나 (실측 결함 2026-09-30)
 *   재개가 7초에 튕겼다 — `400 … Claude Code 2.1.246 does not support this model`.
 *   이 기계에는 설치본이 둘이었고(npm 전역 2.1.246 · VS Code 확장 2.1.283) 사람의 세션은
 *   전부 확장 것으로 돌고 있었는데 우리만 낡은 것을 불렀다. 그때 **이 한 줄이 없어서**
 *   프로세스 목록을 뒤지고 바이너리를 뜯어 봐야 했다. 진단은 한 명령이어야 한다.
 *
 * 세는 것이 아니라 **보여주는** 명령이다 — 아무것도 고치지 않는다.
 */
import { claudeInstalls, claudeBin, cliVersion } from './lib/cli.mjs'
import { scanSessions } from './lib/sessions.mjs'

const picked = claudeBin()
console.log('설치본 (버전은 실행 없이 읽는다):')
for (const x of claudeInstalls()) {
  console.log(`  ${x.version || '(버전 모름)'}  [${x.from}]  ${x.path}${x.path === picked ? '   ← 고른 것' : ''}`)
}
console.log(`\n띄우는 것: ${picked}`)
console.log(`  --version 이 답하는 값: ${cliVersion({ ttlMs: 0 })}`)

/**
 * 🔴 세션이 **마지막으로 쓴 버전**과 견준다. 우리 것이 낡으면 그 세션의 모델을 모를 수 있고,
 *   그러면 회차는 몇 초 만에 400 으로 튕긴다(화면도 «CLI어긋남» 경고로 말한다).
 */
const ours = (cliVersion({ ttlMs: 0 }).match(/\d+\.\d+\.\d+/) || [])[0] || null
const scan = scanSessions()
const rows = scan.sessions.filter((s) => s.version).slice(0, 12)
console.log('\n세션이 마지막으로 쓴 버전:')
for (const s of rows) {
  const mark = ours && s.version !== ours ? (s.version > ours ? '  ← 우리보다 새것(위험)' : '') : ''
  console.log(`  ${s.sessionId.slice(0, 8)}  ${s.version}${mark}  ${(s.title || '').slice(0, 30)}`)
}
