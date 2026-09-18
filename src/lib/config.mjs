/**
 * config.mjs — 설정 로드와 경로 계산.
 *
 * 왜 설정 파일로 빼는가
 *   원본(Description/_plan/_resume/08-하트비트.mjs)은 `process.cwd()` 의 git 을 읽고
 *   추적기 경로를 상대경로로 박아두었다. 그래서 **그 저장소 안에서만** 돌았다.
 *   RetrySession 은 git 저장소 바깥의 독립 도구라서 같은 방식이 성립하지 않는다 —
 *   대상 저장소를 설정으로 받아 여러 프로젝트를 한 곳에서 관리한다.
 *
 * projects.local.json 이 있으면 그쪽이 이긴다(추적하지 않는다).
 *   `.mcp.json` 과 같은 이유다 — 절대경로는 PC마다 다르므로 커밋하면 남의 환경을 깨뜨린다.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** RetrySession 루트 (이 파일은 <루트>/src/lib/config.mjs 다) */
export const RS_HOME = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '')

const CONFIG = join(RS_HOME, 'config', 'projects.json')
const LOCAL = join(RS_HOME, 'config', 'projects.local.json')

/** 섹션 단위 얕은 병합 — defaults 위에 프로젝트별 값을 덮는다 */
const merge = (base, over) => ({ ...(base || {}), ...(over || {}) })

/**
 * 설정을 읽어 프로젝트 목록을 돌려준다. 기본값은 이미 병합된 상태다.
 * 설정이 깨졌으면 던진다 — 조용히 기본값으로 도는 것보다 멈추는 게 낫다.
 */
export function loadConfig() {
  const path = existsSync(LOCAL) ? LOCAL : CONFIG
  if (!existsSync(path)) throw new Error(`설정이 없다: ${CONFIG} (또는 projects.local.json)`)

  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    throw new Error(`설정 JSON 이 깨졌다 (${path}): ${e.message}`)
  }

  const d = raw.defaults || {}
  const projects = (raw.projects || []).map((p) => {
    if (!p.id) throw new Error('프로젝트에 id 가 없다')
    if (!p.repo) throw new Error(`프로젝트 ${p.id} 에 repo 가 없다`)
    return {
      ...p,
      하트비트: merge(d.하트비트, p.하트비트),
      재개: merge(d.재개, p.재개),
      sessionSlugs: p.sessionSlugs || [],
    }
  })

  if (!projects.length) throw new Error(`설정에 프로젝트가 없다 (${path})`)
  return { 설정파일: path, projects }
}

/** id 로 하나 고른다. 없으면 던진다 — 조용히 첫 프로젝트를 쓰면 엉뚱한 곳에 기록한다 */
export function getProject(id) {
  const { projects, 설정파일 } = loadConfig()
  if (!id) return projects[0]
  const found = projects.find((p) => p.id === id)
  if (!found) {
    throw new Error(`프로젝트 '${id}' 가 설정에 없다 (${설정파일}). 있는 것: ${projects.map((p) => p.id).join(', ')}`)
  }
  return found
}

/**
 * 프로젝트별 상태 파일 경로. 전부 state/<id>/ 아래로 모은다.
 * 🔴 state/ 는 추적하지 않는다(.gitignore) — 5분마다 바뀌므로 커밋하면 이력이 소음으로 찬다.
 */
export function paths(project) {
  const dir = join(RS_HOME, 'state', project.id)
  mkdirSync(dir, { recursive: true })
  return {
    stateDir: dir,
    추적기: join(project.repo, project.tracker || '_plan/_resume/07-실행추적.json'),
    하트비트: join(dir, 'heartbeat.json'),
    하트비트로그: join(dir, 'heartbeat.log'),
    재개상태: join(dir, 'resume.json'),
    재개로그: join(dir, 'resume.log'),
    재개락: join(dir, 'resume.lock'),
  }
}

/** `~/.claude/projects` — 세션 활성 감지와 워크플로 스캔의 뿌리 */
export function claudeProjectsRoot() {
  const home = process.env.USERPROFILE || process.env.HOME
  return home ? join(home, '.claude', 'projects') : null
}
