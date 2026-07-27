/**
 * repos capture — 구 repo `capture_repos`/`_scan_git_dirs_depth1`/
 * `_is_git_worktree`(rigsync.py:1662-1720) 행동 이식. 스캔 대상은
 * `ctx.settings.repoScanDirs`(depth-1 스캔) + `repoExtra`(개별 경로) — 둘 다
 * ctx.homeDir 기준 `~` 표기라 dotfiles capture와 동일하게 실제 fs를 직접 쓴다
 * (스캔 루트 자체가 이미 ctx로 주입된 테스트-안전 경로이기 때문).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { contractHome, expandHome } from '../../paths'
import { REPOS_LAYER } from './constants'
import type { GitProvider } from './providerTypes'
import type { ReposCaptureReport, ReposManifest } from './types'

export class FollowerReposCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerReposCaptureBlockedError'
  }
}

/**
 * git worktree 체크아웃은 `.git`이 (디렉터리가 아니라) gitdir 포인터 *파일*이다.
 * capture는 이걸 절대 캡처 대상 repo로 취급하지 않는다 — 자체 완결적 clone이
 * 아니라 objects가 원본 체크아웃의 .git 안에 있기 때문 (구 repo `_is_git_worktree`).
 */
export function isGitWorktree(absPath: string): boolean {
  try {
    return fs.statSync(path.join(absPath, '.git')).isFile()
  } catch {
    return false
  }
}

/** base 바로 아래(depth 1)에서 `.git`을 가진 디렉터리를 전부 찾는다 (정렬됨). */
export function scanGitDirsDepth1(base: string): string[] {
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) return []
  const out: string[] = []
  for (const name of fs.readdirSync(base).sort()) {
    const full = path.join(base, name)
    try {
      if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, '.git'))) {
        out.push(full)
      }
    } catch {
      // 접근 불가 -- 건너뛴다.
    }
  }
  return out
}

export interface CaptureReposOptions {
  readonly dryRun: boolean
}

export async function captureRepos(
  ctx: RigsyncContext,
  provider: GitProvider,
  options: CaptureReposOptions
): Promise<ReposCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerReposCaptureBlockedError()
  }

  const scanDirs = ctx.settings.repoScanDirs ?? []
  const extra = ctx.settings.repoExtra ?? []
  const ignorePaths = readIgnoreSet(ctx, 'repos', 'paths')
  const existing = (readCommonLayer(ctx, REPOS_LAYER) as ReposManifest).repo ?? []
  const entries = new Map(existing.filter((e) => !ignorePaths.has(e.path)).map((e) => [e.path, e]))

  const foundPaths: string[] = []
  for (const sd of scanDirs) {
    foundPaths.push(...scanGitDirsDepth1(expandHome(ctx, sd)))
  }
  for (const ex of extra) {
    const abs = expandHome(ctx, ex)
    if (fs.existsSync(path.join(abs, '.git'))) foundPaths.push(abs)
  }

  let added = 0
  const warnings: string[] = []
  const notes: string[] = []

  for (const p of foundPaths) {
    const homeForm = contractHome(ctx, p)
    if (ignorePaths.has(homeForm)) {
      notes.push(`ignored: ${homeForm}`)
      continue
    }
    if (isGitWorktree(p)) {
      notes.push(`skipped (worktree): ${homeForm}`)
      continue
    }
    const url = await provider.remoteUrl(p)
    const branch = await provider.branch(p)
    if (!url) warnings.push(`${homeForm}: no remote.origin.url`)
    if (!entries.has(homeForm)) added += 1
    entries.set(homeForm, { path: homeForm, url, branch })
  }

  if (!options.dryRun) {
    writeCommonLayer(ctx, REPOS_LAYER, entries.size > 0 ? { repo: [...entries.values()] } : {})
  }

  return { found: foundPaths.length, captured: entries.size, added, warnings, notes }
}
