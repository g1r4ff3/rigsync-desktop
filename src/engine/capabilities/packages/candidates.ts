/**
 * "동기화 항목" 화면(P2a 결정 ⑤)이 쓰는 데이터 — managed(manifest에 있는 것)와
 * unmanaged(설치는 돼 있지만 manifest엔 없는 것 = 구 repo 표현으로 uncaptured)
 * 후보를 provider별로 묶는다. 구 `gui.py`의 `candidate_groups`가 apt의
 * uncaptured만 다뤘던 것과 달리(참조는 했지만), 이 화면은 세 provider 전부
 * managed+unmanaged를 대칭적으로 보여준다 — 스위치(ignore 토글)를 달아야
 * 하므로 diffPackages()의 필터링(ignore된 항목은 안 보임)을 그대로 쓸 수 없다:
 * 여기서는 ignore 여부를 **표시**해야지 **숨기면 안 된다**.
 */
import { readAptIncludeSet, readIgnoreSet } from '../../ignore'
import type { RigsyncContext } from '../../context'
import type { SyncItem, SyncItemGroup } from '../../syncItems'
import { classifyAptPackagesCached } from './aptQueryCache'
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
    const include = readAptIncludeSet(ctx)
    const managedSet = new Set(manifest.apt?.packages ?? [])
    const liveSet = new Set(providers.apt.manualInstalled())
    const names = [...new Set([...managedSet, ...liveSet])].sort()
    if (names.length > 0) {
      // 무상태 분류(refactor-spec-v0.2 §1)로 두 그룹으로 가른다. 배포판
      // 기본분도 **절대 숨기지 않는다** -- 접힌 그룹으로 보여주고 펼칠 수
      // 있어야 한다(스펙 판단 원칙 2: "보이지 않는 필터링 금지". 구 baseline
      // 구현은 이 목록을 소리 없이 삼켰다).
      const classification = classifyAptPackagesCached(providers.apt, names)
      // R6 R2: 이름 전부를 한 번에 배치 조회한다(159개도 프로세스 1회).
      const descriptions = providers.apt.descriptions(names)
      const toItem = (name: string): SyncItem => ({
        key: name,
        label: name,
        managed: managedSet.has(name),
        ignored: ignore.has(name),
        included: include.has(name),
        description: descriptions[name]
      })
      const userNames = names.filter((n) => classification.get(n) !== 'distro')
      const distroNames = names.filter((n) => classification.get(n) === 'distro')
      if (userNames.length > 0) {
        groups.push({
          capability: 'apt',
          title: 'apt — 사용자 설치',
          subgroup: 'apt-user',
          items: userNames.map(toItem)
        })
      }
      if (distroNames.length > 0) {
        groups.push({
          capability: 'apt',
          title: 'apt — 배포판 기본',
          subgroup: 'apt-distro',
          collapsedByDefault: true,
          items: distroNames.map(toItem)
        })
      }
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
        title: 'snap (검출 전용 — 동기화 대상 아님)',
        detectionOnly: true,
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
      // R6 R2: application마다 이름+설명이 한 번의 flatpak list 호출로 나온다.
      const details = providers.flatpak.appDetails()
      groups.push({
        capability: 'flatpak',
        title: 'flatpak',
        items: names.map((name) => {
          const detail = details[name]
          return {
            key: name,
            label: name,
            managed: managedSet.has(name),
            ignored: ignore.has(name),
            description: detail
              ? detail.description
                ? `${detail.name} — ${detail.description}`
                : detail.name
              : undefined
          }
        })
      })
    }
  }

  return groups
}
