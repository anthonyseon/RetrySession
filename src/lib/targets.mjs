/**
 * targets.mjs — "어떤 세션을 감시하고 재시작할 것인가" 등록부.
 *
 * 왜 파일로 두는가
 *   UI 는 사람이 보는 동안만 떠 있고, 실제로 감시·재시작을 하는 것은 OS 작업 스케줄러가
 *   띄우는 별개 프로세스다. 둘이 대화할 곳이 필요하다 —
 *   **UI 가 쓰고, 하트비트·재개가 읽는다.** UI 를 닫아도 등록은 남는다.
 *
 * 🔴 state/targets.json 은 추적하지 않는다(.gitignore).
 *   어떤 세션을 켰는지는 그 PC 의 사정이고, 세션 id 는 다른 PC 에서 의미가 없다.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { RS_HOME, loadConfig, paths as repoPaths } from './config.mjs'
import { localStamp } from './stamp.mjs'
import { writeJsonAtomic } from './io.mjs'

const registryFile = join(RS_HOME, 'state', 'targets.json')

export const emptyRegistry = () => ({
  _주의: 'UI 가 쓰고 하트비트·재개가 읽는다. 추적하지 않는다 — 세션 id 는 이 PC 에서만 의미가 있다.',
  updatedAt: null,
  targets: {},
})

export function loadTargets() {
  if (!existsSync(registryFile)) return emptyRegistry()
  try {
    const t = JSON.parse(readFileSync(registryFile, 'utf8'))
    return { ...emptyRegistry(), ...t, targets: t.targets || {} }
  } catch (e) {
    // 🔴 깨진 등록부를 빈 것으로 바꿔치면 켜둔 감시가 조용히 꺼진다. 오류를 들고 올라간다.
    throw new Error(`등록부가 깨졌다 (${registryFile}): ${e.message}`)
  }
}

/**
 * 🔴 원자적으로 쓴다 — 이 파일이 이 도구의 단일 실패점이다.
 *   loadTargets() 는 깨진 등록부를 빈 것으로 바꿔치지 않고 던진다(위 주석). 옳은 선택이지만,
 *   그래서 **쓰다가 죽으면 하트비트와 재개가 둘 다 멈춘다.** 켜둔 감시가 통째로 사라지는데
 *   알려주는 곳이 없다. 자르고-쓰는 두 동작 사이를 없앤다.
 */
export function saveTargets(t) {
  mkdirSync(join(RS_HOME, 'state'), { recursive: true })
  writeJsonAtomic(registryFile, { ...t, updatedAt: localStamp() })
}

const emptyTarget = () => ({ 감시: false, 재시작: false, 재개지시: null, 추가시각: localStamp() })

/**
 * 감시를 **방금 켰다면** 그 시각을 epoch 으로 남긴다.
 *
 * 🔴 왜 필요한가 (실측 사건 2026-09-21)
 *   하트비트는 5분마다 돈다. 감시를 켠 직후에는 기록이 없는 것이 정상인데,
 *   판정이 그것을 "끊겼다"로 읽어 치명 경보를 띄웠다. 대기인지 고장인지는
 *   **언제 켰는지**를 알아야 가를 수 있다 (guard.mjs 의 heartbeatVerdict).
 *
 *   문자열 시각(갱신시각)이 아니라 epoch 을 따로 둔다 — 문자열은 로컬 표기라
 *   파싱이 환경에 따라 흔들린다. 낡음 판정은 언제나 epoch 으로 한다.
 *   끌 때는 지운다. 남겨두면 다시 켰을 때 옛 시각으로 판정한다.
 */
function touchWatchTime(이전, patch) {
  if (patch.감시 === true) {
    return 이전.감시 === true ? (이전.감시켠epoch ?? Date.now()) : Date.now()
  }
  if (patch.감시 === false) return undefined
  return 이전.감시켠epoch   // 감시를 건드리지 않는 변경이면 그대로 둔다
}

function updateTarget(이전, patch, meta) {
  const onEpoch = touchWatchTime(이전, patch)
  const next = { ...이전, ...meta, ...patch, 갱신시각: localStamp() }
  if (onEpoch === undefined) delete next.감시켠epoch
  else next.감시켠epoch = onEpoch
  return next
}

/** 대상 하나를 켜고 끈다. 없으면 만든다 */
export function setTarget(sessionId, patch, meta = {}) {
  const t = loadTargets()
  t.targets[sessionId] = updateTarget(t.targets[sessionId] || emptyTarget(), patch, meta)
  saveTargets(t)
  return t.targets[sessionId]
}

/** 여러 대상을 한꺼번에 (UI 의 다중 선택) */
export function setMany(sessionIds, patch, metaBySession = {}) {
  const t = loadTargets()
  const 결과 = {}
  for (const id of sessionIds) {
    t.targets[id] = updateTarget(t.targets[id] || emptyTarget(), patch, metaBySession[id] || {})
    결과[id] = t.targets[id]
  }
  saveTargets(t)
  return 결과
}

export function removeTarget(sessionId) {
  const t = loadTargets()
  delete t.targets[sessionId]
  saveTargets(t)
}

/** 감시가 켜진 대상 목록 */
export const watchTarget = (t = loadTargets()) =>
  Object.entries(t.targets).filter(([, v]) => v.감시).map(([id, v]) => ({ sessionId: id, ...v }))

/** 재시작이 켜진 대상 목록 */
export const resumeTarget = (t = loadTargets()) =>
  Object.entries(t.targets).filter(([, v]) => v.재시작).map(([id, v]) => ({ sessionId: id, ...v }))

/* ── 세션별 상태 파일 경로 ───────────────────────────────────── */

/**
 * 세션 id 로 쓸 수 있는 문자열인가.
 *
 * 🔴 이 값은 HTTP 요청 본문에서도 들어온다. 그대로 경로에 붙이면
 *   `../../..` 하나로 state/ 바깥에 폴더를 만들고 파일을 쓴다.
 *   실제 id 는 UUID 다(실측: 794c2aee-ed0e-4e1c-a08f-8a0656dd54da) — 그 형태만 받는다.
 *   막연히 "구분자만 거른다"가 아니라 **아는 형태만 통과**시킨다.
 */
export const isSessionId = (id) =>
  typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export function statePaths(sessionId) {
  // 경로를 만들기 전에 막는다 — 만든 뒤에 검사하면 이미 만들어진 뒤다
  if (!isSessionId(sessionId)) {
    throw new Error(`세션 id 형태가 아니다: ${JSON.stringify(String(sessionId).slice(0, 80))}`)
  }
  const dir = join(RS_HOME, 'state', 'sessions', sessionId)
  mkdirSync(dir, { recursive: true })
  return {
    stateDir: dir,
    하트비트: join(dir, 'heartbeat.json'),
    hbLogPath: join(dir, 'heartbeat.log'),
    resumeState: join(dir, 'resume.json'),
    resumeLogPath: join(dir, 'resume.log'),
    resumeLock: join(dir, 'resume.lock'),
  }
}

/* ── cwd → 저장소 설정 짝짓기 ────────────────────────────────── */

const re = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * 세션의 cwd 로 config/projects.json 의 프로젝트를 찾는다.
 *
 * 세션은 모노레포 루트에서 시작해 하위 폴더를 작업하는 경우가 많다(실측: Description 작업이
 * EasyAI.Platform 세션에서 돌았다). 그래서 **가장 긴 경로가 먼저 맞는** 순서로 본다.
 * 못 찾으면 기본값만 담은 가상 프로젝트를 돌려준다 — 감시는 설정 없이도 되어야 한다.
 */
export function resolveRepo(cwd) {
  const { projects } = loadConfig()
  const c = re(cwd)
  const candidates = projects
    .filter((p) => c === re(p.repo) || c.startsWith(re(p.repo) + '/'))
    .sort((a, b) => re(b.repo).length - re(a.repo).length)

  if (candidates.length) return { project: candidates[0], hasConfig: true }

  const fallback = projects[0] // defaults 가 병합돼 있으므로 설정값을 빌려 쓴다
  return {
    project: {
      id: `(미등록) ${cwd}`,
      repo: cwd,
      tracker: null,
      sessionSlugs: [],
      하트비트: fallback.하트비트,
      resume: { ...fallback.resume, enabled: true, addDirs: [] },
    },
    hasConfig: false,
  }
}

/** 이 대상에 추적기가 실제로 있는가 (재시작 지시문을 만들 수 있는지의 근거) */
export function trackerPath(project) {
  if (!project.tracker) return null
  const p = repoPaths(project).추적기
  return existsSync(p) ? p : null
}
