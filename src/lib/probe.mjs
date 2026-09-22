/**
 * probe.mjs — 바깥 세계를 관측한다. git 상태 · 워크플로 진행 · 사람 세션 활성.
 *
 * 관측은 전부 "실패하면 모른다고 답한다" 원칙이다. 던지지 않는다 —
 * 하트비트가 관측 하나 실패로 죽으면 기록이 끊기고, 기록이 끊기면 재개가 불가능해진다.
 * 단, **모른다를 정상으로 바꿔 말하지는 않는다**(guard.mjs 의 fail-closed 판정 참조).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { claudeProjectsRoot } from './config.mjs'

/**
 * git 한 번 호출. 실패하면 빈 문자열 — 저장소가 아니거나 git 이 없을 수 있다.
 *
 * 🔴 stderr 를 삼킨다. 감시 대상 cwd 가 git 저장소가 아니면 git 이
 *   `fatal: not a git repository` 를 부모 stderr 로 쏟아내 스케줄러 로그를 더럽힌다.
 *   그건 오류가 아니라 정상적인 경우다 — 결과의 빈 값으로 이미 표현된다.
 */
const git = (repo, ...args) => {
  try {
    return execFileSync('git', args, {
      cwd: repo, encoding: 'utf8', timeout: 15000, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/** 대상 저장소의 git 상태 — 재개 지점을 특정하는 데 쓴다 */
export function gitState(repo) {
  if (!existsSync(repo)) return { noRepo: true, head: '', 커밋수: '', 마지막커밋: '', 미커밋파일수: 0 }
  const dirty = git(repo, 'status', '--porcelain').split('\n').filter(Boolean).length
  return {
    head: git(repo, 'rev-parse', '--short', 'HEAD'),
    브랜치: git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    커밋수: git(repo, 'rev-list', '--count', 'HEAD'),
    마지막커밋: git(repo, 'log', '-1', '--pretty=%s').slice(0, 120),
    미커밋파일수: dirty,
  }
}

/** 설정된 슬러그들 아래의 세션 폴더 전체 (`~/.claude/projects/<slug>/<sessionId>`) */
function sessionDirs(slugs) {
  const root = claudeProjectsRoot()
  if (!root || !existsSync(root)) return []
  const out = []
  for (const slug of slugs) {
    const base = join(root, slug)
    if (!existsSync(base)) continue
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (e.isDirectory()) out.push(join(base, e.name))
    }
  }
  return out
}

/**
 * 돌고 있는 워크플로의 진행(시작/완료 수).
 *
 * 원본은 세션 id 하나를 코드에 박아두었다 — 세션이 바뀌면 조용히 빈 배열이 됐다.
 * 여기서는 설정된 슬러그 아래 **모든** 세션을 훑는다.
 */
export function liveWorkflows(slugs, maxAgeMin = 10) {
  const out = []
  for (const dir of sessionDirs(slugs)) {
    const wfBase = join(dir, 'subagents', 'workflows')
    if (!existsSync(wfBase)) continue
    for (const d of readdirSync(wfBase)) {
      const p = join(wfBase, d, 'journal.jsonl')
      if (!existsSync(p)) continue
      const ageMin = (Date.now() - statSync(p).mtime.getTime()) / 60000
      if (ageMin > maxAgeMin) continue
      let started = 0, done = 0
      try {
        for (const line of readFileSync(p, 'utf8').split('\n')) {
          if (!line) continue
          const t = JSON.parse(line).type
          if (t === 'started') started++
          else if (t === 'result') done++
        }
      } catch { /* 쓰는 중이면 마지막 줄이 깨질 수 있다 — 그 회차는 건너뛴다 */ }
      out.push({ runId: d, started, done, 마지막기록_분전: +ageMin.toFixed(1) })
    }
  }
  return out
}

/**
 * 사람이 지금 이 프로젝트에서 작업 중인가.
 *
 * 🔴 자율 재개의 핵심 가드다. 세션 기록(`*.jsonl`)의 mtime 은 대화가 진행되는 동안
 *   실시간으로 갱신된다(실측 확인). 사람이 켜둔 세션과 헤드리스 재개가 같은
 *   워킹트리를 동시에 건드리면 서로의 편집을 덮어쓴다.
 *
 * 판정 불가(슬러그 미설정·폴더 없음)면 `{알수없음: true}` 로 답한다.
 * 호출부는 이것을 "활성"으로 취급한다 — 모르면 재개하지 않는다(fail-closed).
 */
export function sessionActivity(slugs) {
  const root = claudeProjectsRoot()
  if (!root || !existsSync(root)) return { unknownModel: true, 이유: `~/.claude/projects 를 찾을 수 없다` }
  if (!slugs || !slugs.length) return { unknownModel: true, 이유: 'sessionSlugs 가 설정되지 않았다' }

  let newest = 0, file = null, seen = 0
  for (const slug of slugs) {
    const base = join(root, slug)
    if (!existsSync(base)) continue
    seen++
    for (const e of readdirSync(base, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue
      const m = statSync(join(base, e.name)).mtime.getTime()
      if (m > newest) { newest = m; file = `${slug}/${e.name}` }
    }
  }

  if (!seen) return { unknownModel: true, 이유: `설정된 슬러그가 하나도 없다: ${slugs.join(', ')}` }
  if (!newest) return { unknownModel: false, noRecord: true, ageMin: null, file: null }
  return { unknownModel: false, ageMin: +((Date.now() - newest) / 60000).toFixed(1), file, atEpoch: newest }
}
