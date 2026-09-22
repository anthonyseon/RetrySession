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
import { readFileSync } from 'node:fs'
import { localStamp } from './stamp.mjs'
import { readTracker } from './tracker.mjs'
import { gitState } from './probe.mjs'
import { heartbeatVerdict, loadRunState, budgetVerdict } from './guard.mjs'
import { scanSessions } from './sessions.mjs'
import { runningSessions, account, cliVersion } from './cli.mjs'
import { loadTargets, statePaths, resolveRepo, trackerPath } from './targets.mjs'
import { taskState } from './scheduler.mjs'
import { ideWindows, findWindow, sessionsByFolder } from './ide.mjs'
import { claudeProcesses } from './procs.mjs'
import { allLockState } from './single.mjs'
import { currentAlerts, recentAlerts } from './alerts.mjs'
import { paths as repoPaths } from './config.mjs'
import { totalCost } from './pricing.mjs'
import { pcState } from './pc.mjs'
// 보기 변환은 view.mjs 로 옮겼다. tail 은 바깥(server.mjs)에서도 쓰므로 다시 내보낸다.
import { tail, quotaView } from './view.mjs'
export { tail, quotaView }

/* ── 세션 하나의 감시·재시작 상태 ────────────────────────────── */

/**
 * @param 실행중앎 실행 중 목록 조회가 성공했는가. false 면 "정지"라고 말할 수 없다.
 */
function sessionView(s, 등록, 실행중맵, ide창 = [], 프로세스맵 = new Map(), 실행중앎 = true) {
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
  let 감시상태 = { 켜짐: !!대상?.감시, 기록있음: false, verdict: null, 마지막기록: null }
  if (P) {
    let hb = null
    try { hb = JSON.parse(readFileSync(P.하트비트, 'utf8')) } catch { hb = null }
    const 한계 = project?.하트비트?.낡음한계분 ?? 15
    /**
     * 감시를 켠 시각. 이것이 있어야 "첫 기록 대기"와 "끊김"을 가를 수 있다.
     * 옛 등록부에는 epoch 이 없으므로 문자열 시각으로 물러선다(없으면 null).
     */
    const 켠epoch = typeof 대상.감시켠epoch === 'number'
      ? 대상.감시켠epoch
      : (Date.parse(대상.갱신시각 || 대상.추가시각 || '') || null)
    감시상태 = {
      켜짐: !!대상.감시,
      기록있음: !!hb,
      verdict: 대상.감시 ? heartbeatVerdict(hb, 한계, Date.now(), 켠epoch) : null,
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

  const 비용 = totalCost(s.모델별)

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

    /**
     * 🔴 "정지"와 "모름"은 다르다.
     *
     *   실측 결함 (2026-09-21): `runningSessions()` 의 ok 를 보지 않고 목록만 썼다.
     *   CLI 조회가 실패하면 목록이 비어서 **모든 세션이 조용히 '정지'로** 보였다 —
     *   화면에도, 하트비트 기록에도, 트레이 개수에도. 조회 실패는 `agents조회` 에
     *   담기고 있었지만 **아무도 읽지 않았다.**
     *   resume.mjs 에서 고친 것과 같은 부류다(guard.mjs 의 세션실행중 참조).
     *   모를 때는 모른다고 말한다.
     */
    실행중: 실행중앎 ? !!run?.살아있음 : false,
    실행여부앎: 실행중앎,
    pid: run?.pid ?? null,
    kind: run?.kind ?? null,
    시작시각: run?.startedAtEpoch ? localStamp(new Date(run.startedAtEpoch)) : null,

    /**
     * 사용량 제한에 잘려 멈춰 있나 — 재개가 이것을 재개 지점으로 인정한다.
     * '제한을 겪었다'가 아니라 '마지막 엔트리가 제한 알림이다' 이다(sessions.mjs).
     */
    제한으로멈춤: !!s.제한으로멈춤,
    제한알림시각: s.제한알림at ? localStamp(new Date(s.제한알림at)) : null,

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
    ide: findWindow(실행cwd, ide창) || findWindow(짝cwd, ide창),

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
  /**
   * 🔴 여기는 **보여주기용**이다. 판정용과 캐시 수명을 다르게 잡는다.
   *
   *   실측 (2026-09-22): 이 호출 하나가 1.0초이고 동기다 — 그동안 서버의 이벤트
   *   루프가 멈춘다. 화면이 3초마다 부르면 1분에 12초를 그렇게 쓴다. 그 사이
   *   아무것도 계산하지 않는 /api/ping 까지 같이 느려진다(.ps1 들이 5초로 판정한다).
   *   화면에 "N초 전 갱신"이 적혀 있으므로 15초 묵은 값은 거짓말이 아니다.
   *
   *   판정(resume.mjs)은 `ttlMs: 0` 으로 **매번 새로** 읽는다. 사람이 쓰는 대화에
   *   끼어들지 않으려면 그쪽은 묵은 값을 쓰면 안 된다.
   */
  const run = runningSessions({ ttlMs: 15000 })
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
  // 같은 이유로 프로세스 목록도 보여주기용 수명을 쓴다 (실측 0.7초, 동기)
  const procs = claudeProcesses({ ttlMs: 15000 })
  const 프로세스맵 = new Map(procs.목록.map((p) => [p.pid, p]))
  const 세션 = [...scan.sessions, ...추가]
    .map((s) => sessionView(s, 등록, 실행중맵, ide.창, 프로세스맵, run.ok))

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
  const 폴더 = sessionsByFolder(ide.창, 세션)

  const acct = account()
  const 총토큰 = 세션.reduce((a, s) => a + s.토큰합, 0)
  const 총USD = +세션.reduce((a, s) => a + s.비용USD, 0).toFixed(2)
  const 락 = allLockState()

  const 기본 = {
    at: localStamp(),
    atEpoch: Date.now(),
    계정: acct,
    cli: { 버전: cliVersion(), agents조회: { ok: run.ok, 오류: run.오류 } },
    할당량: quotaView(scan.할당량),
    // PC 전원 설정 — 잠든 PC 는 아무것도 돌리지 않는다. 읽기가 느려서(474ms 실측)
    // 60초 캐시를 쓴다(lib/pc.mjs). 사람이 바꾸기 전에는 그대로이므로 무해하다.
    pc: pcState(),
    작업: taskState(),
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
      // 🔴 조회가 실패했으면 "0개 실행 중"이 아니라 "모른다"다. 화면이 이 값을 보고 구별한다.
      실행여부앎: run.ok,
      실행여부오류: run.ok ? null : run.오류,
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
    락,
    스캔: scan.스캔,
  }

  /**
   * 경보는 나머지가 다 모인 뒤에 판정한다 — 세션·작업·할당량·락을 모두 본다.
   * 🔴 판정은 alerts.mjs 하나다. 화면이 따로 계산하면 트레이·로그와 말이 갈라진다.
   */
  const 경보 = currentAlerts(기본)
  return {
    ...기본,
    경보,
    경보이력: recentAlerts(60),
    합계: {
      ...기본.합계,
      경보: 경보.length,
      치명경보: 경보.filter((a) => a.수준 === 'critical').length,
    },
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

  const dead = 세션.filter((s) => s.감시.켜짐 && s.감시.verdict && !s.감시.verdict.alive).length
  const blocked = 세션.filter((s) => s.재시작.켜짐 && s.재시작.차단).length
  const watched = d.합계.감시켜짐
  const limited = !!(d.할당량.있음 && !d.할당량.이미해제됨)
  const 미등록작업 = Object.entries(d.작업)
    .filter(([k]) => k !== '캐시됨')
    .filter(([, v]) => v.등록됨 === false).length

  // 실행 여부를 모르면 자율 재개가 멈춘 상태다(fail-closed). 조용히 넘기면 안 된다.
  const unknownRun = d.합계.실행여부앎 === false

  // 나쁜 것이 먼저다 — 가장 급한 하나를 아이콘이 나른다
  let kind = 'good', state = 'ok'
  if (dead > 0) { kind = 'crit'; state = 'stalled' }
  else if (unknownRun) { kind = 'crit'; state = 'unknown' }
  else if (blocked > 0) { kind = 'crit'; state = 'blocked' }
  else if (limited) { kind = 'warn'; state = 'limited' }
  else if (watched === 0) { kind = 'off'; state = 'none' }

  return {
    kind, state,
    at: d.at,
    sessions: d.합계.세션수,
    running: d.합계.실행중,
    // 🔴 running:0 과 "모른다"는 다르다. ASCII 키 — tray.ps1 이 코드에 적는다.
    runningKnown: !unknownRun,
    watched,
    resumeOn: d.합계.재시작켜짐,
    dead, blocked, limited,
    unregisteredTasks: 미등록작업,
    limitText: d.할당량.설명 || '',
    account: d.계정.email || '',
    plan: d.계정.subscriptionType || '',
    // 트레이는 개수만 보여준다 — 내용과 조치는 화면에서 한다(풍선 알림 없음)
    alerts: d.합계.경보 || 0,
    criticalAlerts: d.합계.치명경보 || 0,
  }
}
