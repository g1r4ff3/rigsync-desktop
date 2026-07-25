/**
 * "동기화 항목" 화면(결정 ⑤)의 appimage 그룹 — packages/candidates.ts와 같은
 * shape(SyncItemGroup)를 쓴다. managed = manifest에 있는 desktop_id, unmanaged
 * = Gear Lever에 통합돼 있지만 manifest엔 없는 것.
 */
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import type { SyncItemGroup } from '../../syncItems'
import { APPIMAGE_KEY_FIELDS, APPIMAGE_LAYER } from './constants'
import type { GearLeverProvider } from './providerTypes'
import type { AppimageEntry } from './types'

export async function buildAppimageSyncGroup(
  ctx: RigsyncContext,
  provider: GearLeverProvider
): Promise<SyncItemGroup | null> {
  if (!provider.isAvailable()) return null

  const ignore = readIgnoreSet(ctx, 'appimage', 'names')
  const manifest =
    (effectiveLayer(ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS).app as AppimageEntry[] | undefined) ??
    []
  const managedSet = new Set(manifest.map((e) => e.name))
  const liveSet = new Set(provider.listInstalled().map((r) => r.desktopId))
  const names = [...new Set([...managedSet, ...liveSet])].sort()
  if (names.length === 0) return null

  return {
    capability: 'appimage',
    title: 'appimage',
    items: names.map((name) => ({
      key: name,
      label: name,
      managed: managedSet.has(name),
      ignored: ignore.has(name)
    }))
  }
}
