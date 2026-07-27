/**
 * "동기화 항목" 화면용 tools 그룹 — 구 repo가 `_ignore_set(cfg,"tools","packages")`를
 * 실제로 쓰던 유일한 비-packages capability라(rigsync.py:1035/1052) 이 화면에도
 * apt/snap/flatpak과 같은 자격으로 올린다.
 */
import { readIgnoreSet } from '../../ignore'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import type { SyncItemGroup } from '../../syncItems'
import { TOOLS_LAYER } from './constants'
import type { ToolsProvider } from './providerTypes'
import type { ToolsManifest } from './types'

export async function buildToolsSyncGroup(
  ctx: RigsyncContext,
  provider: ToolsProvider
): Promise<SyncItemGroup | null> {
  if (!(await provider.npmNodeAvailable())) return null

  const ignore = readIgnoreSet(ctx, 'tools', 'packages')
  const manifest = effectiveLayer(ctx, TOOLS_LAYER) as ToolsManifest
  const managedSet = new Set(manifest.packages ?? [])
  const liveSet = new Set(Object.keys(await provider.npmGlobals()))
  const names = [...new Set([...managedSet, ...liveSet])].sort()
  if (names.length === 0) return null

  return {
    capability: 'tools',
    title: 'tools (npm 전역 패키지)',
    items: names.map((name) => ({
      key: name,
      label: name,
      managed: managedSet.has(name),
      ignored: ignore.has(name)
    }))
  }
}
