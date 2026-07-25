/**
 * 계층 재분류 감지 — 정책 §5 "발산 정책": "계층이 다름(매니페스트는 T2, 머신은
 * T1) → §1.2 강등이 발생한 것일 수 있으므로 머신 쪽을 신뢰하고 매니페스트
 * 갱신을 제안한다." FORWARD.md §7 결정: 감지는 모든 머신에서 하되, follower는
 * 보고만("reference에서 갱신"), 매니페스트 갱신 제안은 reference에서만
 * (v1은 표시까지 — 원클릭 갱신은 후속).
 *
 * 판정 자체는 INV-1 중복 검출과 같은 이름-포함 휴리스틱을 재사용한다 — "다른
 * 계층에서 발견됨"이라는 신호가 본질적으로 같기 때문(매니페스트 계층엔 없고,
 * 다른 계층의 라이브 상태엔 있으면 재분류로 본다).
 */
import type { GearLeverProvider } from './capabilities/appimage/providerTypes'
import type { PackageProviders } from './capabilities/packages/providerTypes'
import { type DuplicateCapability, type DuplicateSourceItem, namesOverlap } from './duplicates'

export interface ReclassificationEvent {
  readonly name: string
  /** 매니페스트가 이 앱을 선언하고 있다고 믿는 계층. */
  readonly manifestedIn: DuplicateCapability
  /** 실제로 라이브 상태에서 발견된 계층. */
  readonly foundIn: DuplicateCapability
}

/** 계층별 "매니페스트엔 있는데 그 계층에선 안 보임"(각 diff의 toInstall 등) 목록. */
export type MissingByLayer = Readonly<Partial<Record<DuplicateCapability, readonly string[]>>>

export async function detectReclassifications(
  providers: PackageProviders,
  gearLeverProvider: GearLeverProvider,
  missingByLayer: MissingByLayer
): Promise<ReclassificationEvent[]> {
  const live: DuplicateSourceItem[] = []
  if (providers.apt.isAvailable()) {
    for (const name of providers.apt.manualInstalled())
      live.push({ capability: 'apt', label: name })
  }
  if (providers.snap.isAvailable()) {
    for (const row of providers.snap.list()) live.push({ capability: 'snap', label: row.name })
  }
  if (providers.flatpak.isAvailable()) {
    for (const app of providers.flatpak.apps()) {
      live.push({ capability: 'flatpak', label: app.application })
    }
  }
  if (gearLeverProvider.isAvailable()) {
    for (const row of gearLeverProvider.listInstalled()) {
      live.push({ capability: 'appimage', label: row.desktopId })
    }
  }

  const events: ReclassificationEvent[] = []
  for (const [layer, names] of Object.entries(missingByLayer) as Array<
    [DuplicateCapability, readonly string[] | undefined]
  >) {
    for (const name of names ?? []) {
      const foundElsewhere = live.find(
        (item) => item.capability !== layer && namesOverlap(item.label, name)
      )
      if (foundElsewhere) {
        events.push({ name, manifestedIn: layer, foundIn: foundElsewhere.capability })
      }
    }
  }
  return events
}
