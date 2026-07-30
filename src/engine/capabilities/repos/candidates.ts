/**
 * "동기화 항목" 화면용 repos 그룹 — 구 repo가 `_ignore_set(cfg,"repos","paths")`를
 * 쓰던 것(rigsync.py:1684/1725)과 같은 자격.
 */
import { readIgnoreSet } from '../../ignore'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import { contractHome, expandHome } from '../../paths'
import { isSubscribed, readSelectionFilter } from '../../selection'
import type { SyncItem, SyncItemGroup } from '../../syncItems'
import { scanGitDirsDepth1, isGitWorktree } from './capture'
import { REPOS_KEY_FIELDS, REPOS_LAYER } from './constants'
import type { GitProvider } from './providerTypes'
import type { RepoEntry, ReposManifest } from './types'

export async function buildReposSyncGroup(
  ctx: RigsyncContext,
  gitProvider: GitProvider
): Promise<SyncItemGroup | null> {
  const ignore = readIgnoreSet(ctx, 'repos', 'paths')
  const manifest = effectiveLayer(ctx, REPOS_LAYER, REPOS_KEY_FIELDS) as ReposManifest
  const managedEntries = new Map<string, RepoEntry>((manifest.repo ?? []).map((r) => [r.path, r]))
  const managedSet = new Set(managedEntries.keys())

  const scanDirs = ctx.settings.repoScanDirs ?? []
  const found: string[] = []
  for (const sd of scanDirs) found.push(...scanGitDirsDepth1(expandHome(ctx, sd)))
  const liveSet = new Set(found.filter((p) => !isGitWorktree(p)).map((p) => contractHome(ctx, p)))

  const names = [...new Set([...managedSet, ...liveSet])].sort()
  if (names.length === 0) return null

  // WS2("창고 모델" 구독): 목록에서 빼지 않고 부착만 한다.
  const selection = readSelectionFilter(ctx, 'repos')

  // R6 R2: managed 항목은 이미 manifest에 remote URL이 있으니 재조회 없이 그대로
  // 쓴다. live/후보 항목만 git으로 원격 URL을 물어본다(개수가 적어 배치가
  // 필요 없다 -- apt처럼 수백 개가 아니다). 빈 문자열(원격 없음)은 표시할
  // 설명이 없다는 뜻이라 undefined로 접는다. 순차 조회 유지(새 병렬화를
  // 발명하지 않는다 -- perf 3라운드 원칙).
  const items: SyncItem[] = []
  for (const name of names) {
    const managedUrl = managedEntries.get(name)?.url
    const url = managedUrl ?? (await gitProvider.remoteUrl(expandHome(ctx, name))) ?? ''
    items.push({
      key: name,
      label: name,
      managed: managedSet.has(name),
      ignored: ignore.has(name),
      description: url || undefined,
      ...(isSubscribed(selection, name) ? {} : { subscribed: false })
    })
  }

  return { capability: 'repos', title: 'repos', items }
}
