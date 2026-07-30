/**
 * "동기화 항목" 화면(결정 ⑤)의 appimage 그룹 — packages/candidates.ts와 같은
 * shape(SyncItemGroup)를 쓴다. managed = manifest에 있는 desktop_id, unmanaged
 * = Gear Lever에 통합돼 있지만 manifest엔 없는 것.
 */
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import { isSubscribed, readSelectionFilter } from '../../selection'
import type { SyncItemGroup } from '../../syncItems'
import { resolveAppimageUpdateSource } from './capture'
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
  /**
   * capture 불가 판정("추가 불가" 상태, SyncItemState 'unresolvable') — capture를
   * 돌리지 않고도 candidates 빌드 시점에 알아야 하므로 captureAppimage와 같은
   * `resolveAppimageUpdateSource` 판정을 재사용한다(중복 로직 금지). manifest엔
   * 없지만(managed=false) 이 머신에 설치돼 있는 항목만 의미가 있다 — 이미
   * manifest에 있는 항목은 capture가 additive-only라 재판정과 무관하게 보존된다.
   */
  const unresolvableReasonByDesktopId = new Map<string, string>()
  for (const row of installed) {
    if (managedSet.has(row.desktopId)) continue
    const resolved = resolveAppimageUpdateSource(provider, row)
    if (!resolved.ok) unresolvableReasonByDesktopId.set(row.desktopId, resolved.reason)
  }
  const names = [...new Set([...managedSet, ...liveSet])].sort()
  if (names.length === 0) return null

  // WS2("창고 모델" 구독): 목록에서 빼지 않고 부착만 한다.
  const selection = readSelectionFilter(ctx, 'appimage')

  return {
    capability: 'appimage',
    title: 'appimage',
    items: names.map((name) => ({
      key: name,
      label: name,
      managed: managedSet.has(name),
      ignored: ignore.has(name),
      description: nameByDesktopId.get(name),
      ...(isSubscribed(selection, name) ? {} : { subscribed: false }),
      ...(unresolvableReasonByDesktopId.has(name)
        ? { unresolvableReason: unresolvableReasonByDesktopId.get(name) }
        : {})
    }))
  }
}
