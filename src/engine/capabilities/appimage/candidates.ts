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
  if (!(await provider.isAvailable())) return null

  const ignore = readIgnoreSet(ctx, 'appimage', 'names')
  const manifest =
    (effectiveLayer(ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS).app as AppimageEntry[] | undefined) ??
    []
  const managedSet = new Set(manifest.map((e) => e.name))
  const installed = await provider.listInstalled()
  const liveSet = new Set(installed.map((r) => r.desktopId))
  // R6 R2: 설명 필드가 따로 없어 Gear Lever JSON의 `name`(버전 포함, 예:
  // "tev (2.13.1)")을 그대로 한 줄 설명으로 쓴다 -- 실제로 설치돼 있어야만
  // (listInstalled에 잡혀야만) 알 수 있으므로, manifest엔 있지만 지금 설치가
  // 안 된 항목은 description이 없다(추측하지 않는다).
  const nameByDesktopId = new Map(installed.map((r) => [r.desktopId, r.name]))
  const names = [...new Set([...managedSet, ...liveSet])].sort()
  if (names.length === 0) return null

  return {
    capability: 'appimage',
    title: 'appimage',
    items: names.map((name) => ({
      key: name,
      label: name,
      managed: managedSet.has(name),
      ignored: ignore.has(name),
      description: nameByDesktopId.get(name)
    }))
  }
}
