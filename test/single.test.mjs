/**
 * single.test.mjs — 중복 실행 금지를 고정한다.
 *
 * 왜 중요한가
 *   같은 것이 둘 돌면 서로를 밟는다 — 하트비트 둘은 같은 JSON 을 덮어써 기록을 찢고,
 *   재시작 둘은 하루 예산을 두 배로 쓰며 워킹트리를 함께 고친다.
 *   예약의 MultipleInstances 는 스케줄러가 띄우는 것끼리만 막으므로,
 *   사람이 손으로 돌리거나 화면에서 "지금 실행"을 누른 경우는 이 락이 막아야 한다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lockPath, lockState, grab } from '../src/lib/single.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 시험 전용 이름 — 진짜 구성요소 락을 건드리지 않는다 */
const name = () => `__test__${process.pid}_${Math.random().toString(36).slice(2, 8)}`
const plant = (n, v) => writeFileSync(lockPath(n), JSON.stringify(v))
const cleanup = (n) => { try { rmSync(lockPath(n), { force: true }) } catch { /* 없으면 됐다 */ } }

test('락이 없으면 잡힌다', () => {
  const n = name()
  try {
    const r = grab(n)
    assert.equal(r.ok, true)
    assert.ok(existsSync(lockPath(n)))
  } finally { cleanup(n) }
})

test('🔴 살아 있는 프로세스가 잡고 있으면 막는다', () => {
  const n = name()
  try {
    // 이 프로세스는 분명히 살아 있다
    plant(n, { pid: process.pid, at: '2026-09-21 00:00:00', atEpoch: Date.now() })
    const r = grab(n)
    assert.equal(r.ok, false)
    assert.match(r.why, /이미 돌고 있다/)
    assert.match(r.why, new RegExp(String(process.pid)))
  } finally { cleanup(n) }
})

test('죽은 프로세스의 락은 회수한다', () => {
  const n = name()
  try {
    plant(n, { pid: 999_999_999, at: 'x', atEpoch: Date.now() })
    assert.equal(grab(n).ok, true)
  } finally { cleanup(n) }
})

test('🔴 낡음 한계를 넘기면 살아 있어도 회수한다 (죽은 락에 영원히 막히지 않게)', () => {
  const n = name()
  try {
    plant(n, { pid: process.pid, at: 'x', atEpoch: Date.now() - 200 * 60_000 })
    assert.equal(grab(n, { staleMin: 30 }).ok, true)
  } finally { cleanup(n) }
})

test('한계 안이면 막는다 (경계 확인)', () => {
  const n = name()
  try {
    plant(n, { pid: process.pid, at: 'x', atEpoch: Date.now() - 5 * 60_000 })
    assert.equal(grab(n, { staleMin: 30 }).ok, false)
  } finally { cleanup(n) }
})

test('깨진 락 파일은 낡은 것으로 보고 회수한다', () => {
  const n = name()
  try {
    writeFileSync(lockPath(n), '깨짐{{{')
    assert.equal(grab(n).ok, true)
  } finally { cleanup(n) }
})

test('락상태 — 점유/낡음/나이를 구별해 알려준다', () => {
  const n = name()
  try {
    plant(n, { pid: process.pid, at: 'x', atEpoch: Date.now() - 3 * 60_000 })
    const s = lockState(n, 30)
    assert.equal(s.held, true)
    assert.equal(s.stale, false)
    assert.equal(s.pid, process.pid)
    assert.ok(s.ageMin >= 2 && s.ageMin <= 4)

    plant(n, { pid: 999_999_999, at: 'x', atEpoch: Date.now() })
    const d = lockState(n, 30)
    assert.equal(d.held, false, '죽은 pid 는 점유가 아니다')
    assert.equal(d.stale, true)
  } finally { cleanup(n) }
})

test('락이 없으면 점유도 낡음도 아니다', () => {
  const s = lockState(name(), 30)
  assert.equal(s.held, false)
  assert.equal(s.stale, false)
  assert.equal(s.pid, null)
})

/* ── 상태창도 하나만 ─────────────────────────────────────────── */
/**
 * 창은 프로세스가 아니라 **창**을 세야 한다.
 *
 * 실측: `--app=<url>` 은 호출할 때마다 새 창을 만드는데, Chromium 은 같은 프로필의
 * 브라우저 **프로세스를 재사용**한다. 그래서 프로세스를 세면 1개로 보이지만 창은
 * 3개였다(pid 28968 하나에 RetrySession 창 3개).
 *
 * pid 를 저장해 두는 방식은 이 경우 쓸 수 없다. `Start-Process -PassThru` 가
 * 돌려주는 프로세스는 **즉시 종료**되어(실측: -PassThru 가 "프로세스가 종료되어
 * 정보를 읽을 수 없다"로 실패했다) 창을 소유하지 않는다. 그래서 저장 대신
 * 전용 프로필 경로로 매번 찾아낸다 — 그 프로필은 상태창만 쓴다.
 */
const openApp = () => readFileSync(join(ROOT, 'scripts', 'open-app.ps1'), 'utf8')

test('🔴 상태창은 띄우기 전에 이미 있는 창을 먼저 찾는다', () => {
  const s = openApp()
  assert.match(s, /Get-AppWindows/, '기존 창을 찾는 단계가 있어야 한다')
  const foundAt = s.indexOf('$existing = Get-AppWindows')
  const spawnAt = s.indexOf('--app=$Url')
  assert.ok(foundAt > 0, '기존 창 조회가 있어야 한다')
  assert.ok(foundAt < spawnAt, '조회가 실행보다 먼저여야 한다')
})

test('🔴 이미 있으면 앞으로 가져오고 거기서 끝낸다 (새 창을 만들지 않는다)', () => {
  const s = openApp()
  const m = /if \(\$existing\.Count -ge 1\) \{([\s\S]*?)\n\}/.exec(s)
  assert.ok(m, '기존 창 분기가 있어야 한다')
  assert.match(m[1], /Keep-One|SetForegroundWindow|Show-Window/, '앞으로 가져와야 한다')
  assert.match(m[1], /exit 0/, '분기 안에서 끝내야 새 창이 안 뜬다')
  // 한 겹 미룬 것이지 사라진 것이 아니어야 한다
  assert.match(s, /function Keep-One[\s\S]{0,400}?Show-Window/, 'Keep-One 이 앞으로 가져와야 한다')
})

test('🔴 프로세스가 아니라 창을 센다 (같은 프로세스가 창을 여럿 가진다)', () => {
  const s = openApp()
  assert.match(s, /EnumWindows/, '창 열거로 세어야 한다')
  assert.match(s, /Chrome_WidgetWin_1/, '실제 앱 창 클래스로 걸러야 한다')
  assert.match(s, /GetWindowTextLengthW/, '제목 없는 유틸리티 창을 제외해야 한다')
})

test('전용 프로필 경로로 우리 창을 가려낸다 — 제목 매칭은 인코딩·로케일에 깨진다', () => {
  const s = openApp()
  assert.match(s, /--user-data-dir=' \+ \$UserDir|--user-data-dir=\$UserDir/,
    '프로필 경로를 판별자로 써야 한다')
  assert.doesNotMatch(s, /MainWindowTitle -like/,
    '제목으로 창을 찾지 마라 — 한글 제목이 콘솔 인코딩에서 깨진다')
})

test('중복 창이 남아 있으면 정리한다', () => {
  const s = openApp()
  assert.match(s, /WM_CLOSE/, '남은 중복은 닫아야 한다')
  assert.match(s, /KeepExtra/, '정리를 끄는 길도 있어야 한다(진단용)')
})

test('모든 진입점이 open-app.ps1 을 거친다 — 가드가 한 곳에만 있으면 된다', () => {
  for (const [f, desc] of [
    ['start.ps1', 'start.ps1'],
    ['scripts/tray.ps1', '트레이'],
    ['scripts/shortcut.ps1', '바로가기'],
  ]) {
    assert.match(readFileSync(join(ROOT, f), 'utf8'), /open-app\.ps1/,
      `${desc} 가 open-app.ps1 을 거치지 않으면 중복 창이 생긴다`)
  }
})

/**
 * 🔴 실측 (2026-09-22, 사용자 보고 두 번): `start.ps1 -Restart` 로 서버는 새 코드를
 *   들고 떴는데, 이미 열려 있던 창은 **기동 시점의 모듈**을 그대로 들고 있었다.
 *   방금 고친 결함이 화면에 그대로 남아 있고 아무도 경고하지 않는다.
 *   창을 하나만 띄우는 규칙 때문에 사람이 닫고 다시 열어도 같은 창이 앞으로 온다 —
 *   그래서 "F5 를 누르세요"가 유일한 해결이었는데, 그건 해결이 아니다.
 */
test('🔴 -Restart 는 창도 다시 띄운다 (페이지는 열 때의 코드를 들고 있다)', () => {
  const s = openApp()
  assert.match(s, /\[switch\]\$Reload/, '창을 새로 띄우는 길이 있어야 한다')
  const i = s.indexOf('$existing.Count -ge 1 -and $Reload')
  assert.ok(i > 0, '기존 창이 있을 때의 분기여야 한다')
  const section = s.slice(i, i + 1200)
  assert.match(section, /WM_CLOSE/, '옛 창을 닫아야 한다')
  assert.match(section, /Get-AppWindows \(Get-AppPids\)\)\.Count -eq 0/, '닫힌 것을 확인해야 한다')
  assert.match(section, /did not close/, '못 닫았으면 그렇게 말해야 한다 — 창을 겹쳐 띄우면 안 된다')

  const start = readFileSync(join(ROOT, 'start.ps1'), 'utf8')
  assert.match(start, /open-app\.ps1'\) -Port \$Port -NoWait -Reload/,
    '-Restart 가 -Reload 를 넘겨야 한다')
  assert.match(start, /if \(\$Restart\) \{/, '재시작일 때만 다시 띄워야 한다')
})

/* ── 상태 창: 동시에 눌러도 하나 ──────────────────────────────── */

/**
 * 🔴 실측 결함 (2026-09-28, 사용자 보고): 트레이의 '상태 창 열기' 를 누르면 창이
 *   이미 떠 있어도 하나 더 열렸다.
 *
 *   원인은 "먼저 찾고 나중에 띄운다" 만으로는 부족하다는 것이다. 트레이 클릭마다
 *   **새 powershell** 이 뜨고, 그 프로세스는 창을 찾기 전에 Add-Type(C# 컴파일)을
 *   끝내야 한다 — 밀리초가 아니라 초 단위다. 그 틈에 들어온 클릭은 전부 "창 없음"을
 *   보고 각자 하나씩 띄운다.
 *     실측: 창 0개 → 거의 동시에 3번 호출 → **창 3개.**
 *
 *   그래서 두 겹이다. 두 번째가 실제 보증이다:
 *     1. 락 — 한 번에 하나만 판단한다 (best effort)
 *     2. 띄운 뒤 우리 창을 기다려 **남는 것을 닫는다** (항상 돈다)
 */
test('🔴 락으로 한 번에 하나만 판단한다 (클릭 사이의 틈을 막는다)', () => {
  const s = openApp()
  assert.match(s, /open-app\.lock/, '락 파일이 있어야 한다')
  // FileShare None — 죽은 주인이 남긴 파일은 락이 아니다(낡은 락 회수 로직이 필요 없다)
  assert.match(s, /\[System\.IO\.File\]::Open\([^)]*'OpenOrCreate',\s*'Write',\s*'None'\)/,
    '배타 열기로 잡아야 한다 — 파일 존재만 보면 주인이 죽었을 때 영원히 막힌다')
  const lockAt = s.indexOf('open-app.lock')
  const findAt = s.indexOf('$existing = Get-AppWindows')
  assert.ok(lockAt > 0 && lockAt < findAt, '락은 찾기보다 먼저여야 한다')
})

test('🔴 락을 못 잡아도 창은 뜬다 (fail-open — 눌렀는데 아무 일도 없는 것이 더 나쁘다)', () => {
  const s = openApp()
  assert.match(s, /\$lock may still be null/, '못 잡았을 때를 정상 경로로 다뤄야 한다')
  assert.ok(!/exit 1[\s\S]{0,200}open-app\.lock/.test(s), '락 실패로 끝내면 안 된다')
})

test('🔴 띄운 뒤에 남는 창을 닫는다 — 이것이 실제 보증이다', () => {
  const s = openApp()
  const spawnAt = s.indexOf('--app=$Url')
  const reconcileAt = s.lastIndexOf('Keep-One')
  assert.ok(reconcileAt > spawnAt,
    '띄운 뒤에도 한 번 더 세어 정리해야 한다 — 락을 빠져나간 경합이 남긴 창을 치운다')
  assert.match(s.slice(spawnAt), /Get-AppWindows/, '띄운 뒤 다시 세어야 한다')
})

test('락은 끝날 때 반드시 놓는다', () => {
  const s = openApp()
  assert.match(s, /finally \{[\s\S]*?\$lock\.Dispose\(\)/, 'finally 에서 놓아야 한다')
})

test('진단용으로 정리를 끌 수 있다 (-KeepExtra)', () => {
  const s = openApp()
  assert.match(s, /\$KeepExtra/, '중복을 남겨 두고 들여다볼 수단이 있어야 한다')
})
