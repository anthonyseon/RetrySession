/**
 * status.mjs — 화면과 CLI 가 함께 쓰는 상태 집계. 여기서만 모은다.
 *
 * 왜 한 곳인가
 *   같은 판정을 UI 와 CLI 가 따로 쓰면 둘이 서로 다른 답을 하게 된다. 감시 장치가
 *   창구마다 다른 말을 하면 신뢰할 수 없다 — 그래서 집계는 이 파일 하나다.
 *
 * 출처 경계 (실측으로 확인)
 *   CLI `claude agents --json`      → 실행 중 세션·pid  (사람이 쓰고 있나의 정답)
 *   CLI `claude auth status --json` → 계정·구독
 *   트랜스크립트                     → 토큰·비용·제목·할당량
 *   state/                          → 감시 기록 · 재시작 이력 · 등록부
 *   schtasks                        → OS 예약 등록 여부
 */
import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { localStamp, minutesSince } from './stamp.mjs'
import { readTracker } from './tracker.mjs'
import { gitState } from './probe.mjs'
import { heartbeatVerdict, loadRunState, budgetVerdict } from './guard.mjs'
import { scanSessions } from './sessions.mjs'
import { runningSessions, account, cliVersion } from './cli.mjs'
import { loadTargets, statePaths, resolveRepo, trackerPath } from './targets.mjs'
import { 작업상태 } from './scheduler.mjs'
import { ideWindows, 창찾기, 폴더별세션 } from './ide.mjs'
import { claudeProcesses } from './procs.mjs'
import { paths as repoPaths } from './config.mjs'
import { 총비용 } from './pricing.mjs'

/* ── 로그 꼬리 읽기 ─────────────────────────────────────────── */

/**
 * 파일 끝에서 N줄. 🔴 전체를 읽지 않는다 — 로그는 계속 자라고 UI 는 자주 물어본다.
 * 마지막 64KB 만 읽어 그 안에서 줄을 센다.
 */
export function tail(path, n = 40, maxBytes = 65536) {
  if (!path || !existsSync(path)) return []
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    if (len <= 0) return []
    const fd = openSync(path, 'r')
    try {
      const buf = Buffer.allocUnsafe(len)
      readSync(fd, buf, 0, len, start)
      let text = buf.toString('utf8')
      // 앞이 잘렸으면 첫 줄은 깨졌을 수 있다 — 버린다
      if (start > 0) {
        const nl = text.indexOf('\n')
        if (nl >= 0) text = text.slice(nl + 1)
      }
      return text.split('\n').filter((l) => l !== '').slice(-n)
    } finally { closeSync(fd) }
  } catch { return [] }
}

/* ── 할당량 보기 ─────────────────────────────────────────────── */

/**
 * quotaLimits 를 사람이 읽을 형태로.
 *
 * 🔴 이 값은 **마지막으로 제한에 걸렸을 때 기록된 것**이다. 지금 상태가 아니다.
 *   resetsAt 이 과거면 이미 풀린 것이다 — 그걸 명시하지 않으면 "지금 막혀 있다"고 오해한다.
 */
export function 할당량보기(q) {
  if (!q) return { 있음: false, 설명: '기록 없음 — 이 PC 의 트랜스크립트에 제한 기록이 없다' }
  const resetMs = q.resetsAt ? q.resetsAt * 1000 : null
  const 남은분 = resetMs ? Math.round((resetMs - Date.now()) / 60000) : null
  const 지남 = 남은분 !== null && 남은분 <= 0
  return {
    있음: true,
    status: q.status || null,
    종류: q.rateLimitType || null,
    기록시각: q._at ? localStamp(new Date(q._at)) : null,
    기록_분전: q._at ? Math.round(minutesSince(q._at)) : null,
    해제시각: resetMs ? localStamp(new Date(resetMs)) : null,
    해제_남은분: 남은분,
    이미해제됨: 지남,
    초과사용중: !!q.isUsingOverage,
    초과상태: q.overageStatus || null,
    초과불가이유: q.overageDisabledReason || null,
    대체가능: !!q.unifiedRateLimitFallbackAvailable,
    설명: 지남
      ? `마지막 제한(${q.rateLimitType || '?'})은 이미 해제됐다 — ${resetMs ? localStamp(new Date(resetMs)) : '?'} 기준`
      : `제한 ${q.status || '?'} · ${q.rateLimitType || '?'} · ${남은분}분 후 해제`,
  }
}

/* ── 세션 하나의 감시·재시작 상태 ────────────────────────────── */

function 세션상태(s, 등록, 실행중맵, ide창 = [], 프로세스맵 = new Map()) {
  const run = 실행중맵.get(s.sessionId) || null
  const 대상 = 등록.targets[s.sessionId] || null

  /**
   * 🔴 세션의 cwd 는 하나가 아니다(실측). 셋을 구별해 쓴다:
   *   실행cwd — 프로세스를 띄운 자리. CLI 가 말해주는 값이 정답이고, 재시작을 여기서 띄운다.
   *   주작업cwd — 가장 많이 머문 곳. 무엇을 하던 세션인가이고, 저장소·추적기 짝짓기는 이쪽이다.
   *   최근cwd — 마지막으로 있던 곳. 중단 지점의 단서다.
   */
  const 실행cwd = run?.cwd || s.cwd시작 || s.주작업cwd || null
  const 짝cwd = s.주작업cwd || s.cwd최근 || 실행cwd
  const { project, 설정있음 } = 짝cwd ? resolveRepo(짝cwd) : { project: null, 설정있음: false }
  const P = 대상 ? statePaths(s.sessionId) : null

  /* 감시 */
  let 감시상태 = { 켜짐: !!대상?.감시, 기록있음: false, 판정: null, 마지막기록: null }
  if (P) {
    let hb = null
    try { hb = JSON.parse(readFileSync(P.하트비트, 'utf8')) } catch { hb = null }
    const 한계 = project?.하트비트?.낡음한계분 ?? 15
    감시상태 = {
      켜짐: !!대상.감시,
      기록있음: !!hb,
      판정: 대상.감시 ? heartbeatVerdict(hb, 한계) : null,
      한계분: 한계,
      마지막기록: hb ? { at: hb.at, 단계: hb.현재단계?.id, 완료: hb.현재단계?.완료단계 } : null,
      로그: tail(P.하트비트로그, 12),
    }
  }

  /* 재시작 */
  let 재시작상태 = { 켜짐: !!대상?.재시작 }
  if (P && project) {
    const st = loadRunState(P.재개상태)
    const b = budgetVerdict(st, project.재개)
    재시작상태 = {
      켜짐: !!대상.재시작,
      권한모드: project.재개.권한모드,
      오늘실행: b.오늘실행,
      하루최대회: project.재개.하루최대회,
      오늘비용: b.오늘비용,
      하루최대비용USD: project.재개.하루최대비용USD ?? null,
      연속실패: st.연속실패 || 0,
      연속실패한계: project.재개.연속실패한계,
      차단: st.차단 || null,
      손상: st.손상 || null,
      예산통과: b.ok,
      예산이유: b.why,
      마지막실행: st.마지막실행 || null,
      로그: tail(P.재개로그, 24),
    }
  }

  /* 추적기 — 재시작 지점의 근거 */
  let 추적기 = { 있음: false }
  if (project) {
    const tp = trackerPath(project)
    if (tp) {
      const t = readTracker(tp)
      추적기 = {
        있음: true, 경로: project.tracker, 완료표기: t.완료표기, 전부완료: t.전부완료,
        doing: t.doing, 다음todo: t.다음todo, doing위반: t.doing위반,
        nextAction: t.nextAction, 오류: t.error,
      }
    } else if (project.tracker) {
      추적기 = { 있음: false, 경로: project.tracker, 설명: '설정에 경로는 있는데 파일이 없다' }
    }
  }

  const 비용 = 총비용(s.모델별)

  return {
    sessionId: s.sessionId,
    짧은id: s.sessionId.slice(0, 8),
    slug: s.slug,
    실행cwd,
    주작업cwd: s.주작업cwd || null,
    최근cwd: s.cwd최근 || null,
    cwd상위: s.cwd상위 || [],
    여러저장소: (s.cwd상위 || []).length > 1,
    제목: s.title || run?.name || null,
    cli이름: run?.name || null,
    gitBranch: s.gitBranch,
    cli버전: s.version,

    실행중: !!run?.살아있음,
    pid: run?.pid ?? null,
    kind: run?.kind ?? null,
    시작시각: run?.startedAtEpoch ? localStamp(new Date(run.startedAtEpoch)) : null,

    마지막활동: s.마지막활동 ? localStamp(new Date(s.마지막활동)) : null,
    활성분: s.활성분,
    첫활동: s.첫활동 ? localStamp(new Date(s.첫활동)) : null,

    사용자메시지: s.사용자메시지,
    어시스턴트메시지: s.어시스턴트메시지,
    도구호출: s.도구호출,
    토큰합: s.토큰합,
    비용USD: 비용.usd,
    비용추정포함: 비용.추정포함,
    모델별: 비용.모델별,
    바이트: s.바이트,

    // 이 세션이 어느 VS Code 창에서 열린 폴더에 있나 (살아있는 창만)
    ide: 창찾기(실행cwd, ide창) || 창찾기(짝cwd, ide창),

    /**
     * 실제 프로세스. `claude agents --json` 이 주는 pid 로 짝짓는다.
     * 여기서만 알 수 있는 것: 어느 바이너리인지(VS Code 확장 vs npm), 권한 우회 여부,
     * --add-dir 로 붙은 폴더. 특히 권한 우회는 사람이 알아야 한다.
     */
    프로세스: run?.pid ? (프로세스맵.get(run.pid) || null) : null,

    등록됨: !!대상,
    재개지시: 대상?.재개지시 || null,
    저장소설정있음: 설정있음,
    저장소id: project?.id || null,
    감시: 감시상태,
    재시작: 재시작상태,
    추적기,
    // git 조회는 프로세스를 띄운다 — 감시를 켠 대상만 본다
    git: 짝cwd && 대상?.감시 ? gitState(짝cwd) : null,
  }
}

/* ── 전체 ────────────────────────────────────────────────────── */

/**
 * 화면 한 장에 필요한 모든 것.
 * @param {boolean} opts.가벼움 true 면 git 조회 같은 느린 것을 건너뛴다
 */
export function fullStatus() {
  const 등록 = loadTargets()
  const scan = scanSessions()
  const run = runningSessions()
  const 실행중맵 = new Map(run.sessions.map((s) => [s.sessionId, s]))

  // CLI 가 아는데 트랜스크립트에 아직 없는 세션(방금 시작)도 목록에 넣는다
  const 본것 = new Set(scan.sessions.map((s) => s.sessionId))
  const 추가 = run.sessions
    .filter((r) => !본것.has(r.sessionId))
    .map((r) => ({
      sessionId: r.sessionId, slug: null, title: r.name,
      cwd시작: r.cwd, cwd최근: r.cwd, 주작업cwd: r.cwd,
      cwd상위: [{ 경로: r.cwd, 엔트리: 0 }], cwd분포: {},
      gitBranch: null, version: null, 첫활동: r.startedAtEpoch, 마지막활동: r.startedAtEpoch,
      사용자메시지: 0, 어시스턴트메시지: 0, 도구호출: 0, 모델별: {}, 할당량: null,
      바이트: 0, 활성분: +((Date.now() - r.startedAtEpoch) / 60000).toFixed(1), 토큰합: 0,
    }))

  const ide = ideWindows()
  const procs = claudeProcesses()
  const 프로세스맵 = new Map(procs.목록.map((p) => [p.pid, p]))
  const 세션 = [...scan.sessions, ...추가].map((s) => 세션상태(s, 등록, 실행중맵, ide.창, 프로세스맵))

  /**
   * 🔴 세션 행에 짝지어지지 않은 claude.exe — "목록에 없는 것"의 정체다.
   *
   * 실측: `claude agents --json` 이 2개를 보고할 때 실제로는 4개가 돌고 있었다.
   * 나머지 둘은 `--claude-in-chrome-mcp` 보조라 세션이 아닌 게 맞았지만,
   * CLI 만 믿었으면 그 존재조차 몰랐다. 무엇이 돌고 있는지는 전부 보여주고,
   * 세션이 아닌 것은 그렇다고 적는다.
   */
  const 짝지어진pid = new Set(세션.map((s) => s.pid).filter(Boolean))
  const 짝없는프로세스 = procs.목록.filter((p) => !짝지어진pid.has(p.pid))

  /**
   * 열린 폴더별 세션 수 — "왜 이 폴더의 세션이 목록에 없나"에 답하기 위한 것이다.
   *
   * 실측 사례: Description 은 VS Code 에 폴더로 열려 있고 작업도 그곳에서 했지만,
   * `~/.claude/projects/<Description 슬러그>/` 에는 트랜스크립트(.jsonl)가 0개였다.
   * 그 폴더에서 Claude Code 를 **시작한** 적이 없고, 세션은 EasyAI.Platform 에서
   * 시작해 Description 으로 옮겨가 일했을 뿐이다. 세션 목록만 보면 이 차이를
   * 설명할 수 없으므로 열린 폴더를 나란히 놓는다.
   */
  const 폴더 = 폴더별세션(ide.창, 세션)

  const acct = account()
  const 총토큰 = 세션.reduce((a, s) => a + s.토큰합, 0)
  const 총USD = +세션.reduce((a, s) => a + s.비용USD, 0).toFixed(2)

  return {
    at: localStamp(),
    atEpoch: Date.now(),
    계정: acct,
    cli: { 버전: cliVersion(), agents조회: { ok: run.ok, 오류: run.오류 } },
    할당량: 할당량보기(scan.할당량),
    작업: 작업상태(),
    ide: {
      창: ide.창,
      오류: ide.오류,
      살아있는창: ide.창.filter((w) => w.살아있음).length,
      낡은lock: ide.창.filter((w) => w.낡음).length,
      폴더,
    },
    프로세스: {
      ok: procs.ok,
      오류: procs.오류,
      목록: procs.목록,
      세션수: procs.세션수,
      보조수: procs.보조수,
      짝없음: 짝없는프로세스,
      // CLI 가 보고한 세션 수와 실제 세션형 프로세스 수가 다르면 그 자체가 정보다
      불일치: procs.ok && procs.세션수 !== 세션.filter((s) => s.실행중).length,
    },
    세션,
    합계: {
      세션수: 세션.length,
      실행중: 세션.filter((s) => s.실행중).length,
      감시켜짐: 세션.filter((s) => s.감시.켜짐).length,
      재시작켜짐: 세션.filter((s) => s.재시작.켜짐).length,
      // 열려 있지만 그 폴더에서 시작된 세션이 없는 곳 — 목록에 "없어 보이는" 이유다
      세션없는폴더: 폴더.filter((f) => f.여기서시작 === 0).length,
      claude프로세스: procs.목록.length,
      권한우회세션: 세션.filter((s) => s.프로세스?.위험권한).length,
      총토큰,
      총USD,
      // 🔴 구독(max)이면 정가 환산은 청구액이 아니다. 화면이 이 문장을 그대로 보여준다.
      비용해석: acct.구독제
        ? `정가 환산 참고값 — 구독(${acct.subscriptionType})이므로 실제 청구액이 아니다`
        : '정가 기준 환산액',
    },
    스캔: scan.스캔,
  }
}

/**
 * 트레이 아이콘용 요약. **키가 전부 ASCII 다.**
 *
 * 🔴 왜 따로 있나
 *   `scripts/tray.ps1` 은 ASCII 여야 한다(PowerShell 5.1 이 ANSI 로 읽는다). 그런데
 *   fullStatus() 의 속성명은 한글이라 그 스크립트가 코드에 적을 수 없다.
 *   그래서 ASCII 키로 갈아 담은 창구를 하나 둔다.
 *
 * 🔴 판정(`kind`)도 여기서 한다 — 트레이가 따로 계산하면 화면과 트레이가
 *   서로 다른 말을 하게 된다. 집계는 한 곳이라는 규칙을 지킨다.
 *
 * @returns {{kind:'good'|'warn'|'crit'|'off', ...}}
 */
export function trayStatus() {
  const d = fullStatus()
  const 세션 = d.세션

  const dead = 세션.filter((s) => s.감시.켜짐 && s.감시.판정 && !s.감시.판정.alive).length
  const blocked = 세션.filter((s) => s.재시작.켜짐 && s.재시작.차단).length
  const watched = d.합계.감시켜짐
  const limited = !!(d.할당량.있음 && !d.할당량.이미해제됨)
  const 미등록작업 = Object.entries(d.작업)
    .filter(([k]) => k !== '캐시됨')
    .filter(([, v]) => v.등록됨 === false).length

  // 나쁜 것이 먼저다 — 가장 급한 하나를 아이콘이 나른다
  let kind = 'good', state = 'ok'
  if (dead > 0) { kind = 'crit'; state = 'stalled' }
  else if (blocked > 0) { kind = 'crit'; state = 'blocked' }
  else if (limited) { kind = 'warn'; state = 'limited' }
  else if (watched === 0) { kind = 'off'; state = 'none' }

  return {
    kind, state,
    at: d.at,
    sessions: d.합계.세션수,
    running: d.합계.실행중,
    watched,
    resumeOn: d.합계.재시작켜짐,
    dead, blocked, limited,
    unregisteredTasks: 미등록작업,
    limitText: d.할당량.설명 || '',
    account: d.계정.email || '',
    plan: d.계정.subscriptionType || '',
  }
}
