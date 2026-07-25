/**
 * "동기화 항목" 화면(P2a 결정 ⑤)이 쓰는 데이터 — managed(manifest에 있는 것)와
 * unmanaged(설치는 돼 있지만 manifest엔 없는 것 = 구 repo 표현으로 uncaptured)
 * 후보를 provider별로 묶는다. 구 `gui.py`의 `candidate_groups`가 apt의
 * uncaptured만 다뤘던 것과 달리(참조는 했지만), 이 화면은 세 provider 전부
 * managed+unmanaged를 대칭적으로 보여준다 — 스위치(ignore 토글)를 달아야
 * 하므로 diffPackages()의 필터링(ignore된 항목은 안 보임)을 그대로 쓸 수 없다:
 * 여기서는 ignore 여부를 **표시**해야지 **숨기면 안 된다**.
 */
import { readIgnoreSet } from '../../ignore'
import type { RigsyncContext } from '../../context'
import type { SyncItemGroup } from '../../syncItems'
import { readEffectivePackages } from './io'
import type { PackageProviders } from './providerTypes'

export async function buildPackageSyncGroups(
  ctx: RigsyncContext,
  providers: PackageProviders
): Promise<SyncItemGroup[]> {
  const manifest = readEffectivePackages(ctx)
  const groups: SyncItemGroup[] = []

  if (providers.apt.isAvailable()) {
    const ignore = readIgnoreSet(ctx, 'apt', 'packages')
    const managedSet = new Set(manifest.apt?.packages ?? [])
    const liveSet = new Set(providers.apt.manualInstalled())
    const names = [...new Set([...managedSet, ...liveSet])].sort()
    if (names.length > 0) {
      groups.push({
        capability: 'apt',
        title: 'apt',
        items: names.map((name) => ({
          key: name,
          label: name,
          managed: managedSet.has(name),
          ignored: ignore.has(name)
        }))
      })
    }
  }

  if (providers.snap.isAvailable()) {
    const ignore = readIgnoreSet(ctx, 'snap', 'packages')
    const managedSet = new Set((manifest.snap?.snap ?? []).map((s) => s.name))
    const liveSet = new Set(providers.snap.list().map((r) => r.name))
    const names = [...new Set([...managedSet, ...liveSet])].sort()
    if (names.length > 0) {
      groups.push({
        capability: 'snap',
        title: 'snap',
        items: names.map((name) => ({
          key: name,
          label: name,
          managed: managedSet.has(name),
          ignored: ignore.has(name)
        }))
      })
    }
  }

  if (providers.flatpak.isAvailable()) {
    const ignore = readIgnoreSet(ctx, 'flatpak', 'apps')
    const managedSet = new Set((manifest.flatpak?.app ?? []).map((a) => a.application))
    const liveSet = new Set(providers.flatpak.apps().map((a) => a.application))
    const names = [...new Set([...managedSet, ...liveSet])].sort()
    if (names.length > 0) {
      groups.push({
        capability: 'flatpak',
        title: 'flatpak',
        items: names.map((name) => ({
          key: name,
          label: name,
          managed: managedSet.has(name),
          ignored: ignore.has(name)
        }))
      })
    }
  }

  return groups
}
