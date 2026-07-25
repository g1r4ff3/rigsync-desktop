/**
 * "동기화 항목" 화면용 repos 그룹 — 구 repo가 `_ignore_set(cfg,"repos","paths")`를
 * 쓰던 것(rigsync.py:1684/1725)과 같은 자격.
 */
import { readIgnoreSet } from '../../ignore'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import type { SyncItemGroup } from '../../syncItems'
import { scanGitDirsDepth1, isGitWorktree } from './capture'
import { contractHome, expandHome } from '../../paths'
import { REPOS_KEY_FIELDS, REPOS_LAYER } from './constants'
import type { ReposManifest } from './types'

export async function buildReposSyncGroup(ctx: RigsyncContext): Promise<SyncItemGroup | null> {
  const ignore = readIgnoreSet(ctx, 'repos', 'paths')
  const manifest = effectiveLayer(ctx, REPOS_LAYER, REPOS_KEY_FIELDS) as ReposManifest
  const managedSet = new Set((manifest.repo ?? []).map((r) => r.path))

  const scanDirs = ctx.settings.repoScanDirs ?? []
  const found: string[] = []
  for (const sd of scanDirs) found.push(...scanGitDirsDepth1(expandHome(ctx, sd)))
  const liveSet = new Set(found.filter((p) => !isGitWorktree(p)).map((p) => contractHome(ctx, p)))

  const names = [...new Set([...managedSet, ...liveSet])].sort()
  if (names.length === 0) return null

  return {
    capability: 'repos',
    title: 'repos',
    items: names.map((name) => ({
      key: name,
      label: name,
      managed: managedSet.has(name),
      ignored: ignore.has(name)
    }))
  }
}
