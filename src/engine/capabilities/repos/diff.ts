/**
 * repos diff — 구 repo `diff_repos`(rigsync.py:1723) 행동 이식. worktree
 * 디렉터리가 이미 존재하면(clone 아니었어도) "present"로 취급해 clone을 제안하지
 * 않는다 — 정책이 명시한 계승 함정.
 */
import fs from 'node:fs'
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import { expandHome } from '../../paths'
import { isSubscribed, readSelectionFilter } from '../../selection'
import { REPOS_KEY_FIELDS, REPOS_LAYER } from './constants'
import type { ReposDiffReport, ReposManifest, RepoEntry } from './types'

export async function diffRepos(ctx: RigsyncContext): Promise<ReposDiffReport> {
  const manifest = effectiveLayer(ctx, REPOS_LAYER, REPOS_KEY_FIELDS) as ReposManifest
  const ignorePaths = readIgnoreSet(ctx, 'repos', 'paths')
  const selection = readSelectionFilter(ctx, 'repos')
  const toClone: RepoEntry[] = []
  const manualNoUrl: string[] = []

  for (const r of manifest.repo ?? []) {
    if (ignorePaths.has(r.path)) continue
    if (!isSubscribed(selection, r.path)) continue
    const abs = expandHome(ctx, r.path)
    if (fs.existsSync(abs)) continue
    if (r.url) toClone.push(r)
    else manualNoUrl.push(r.path)
  }

  return { toClone, manualNoUrl }
}
