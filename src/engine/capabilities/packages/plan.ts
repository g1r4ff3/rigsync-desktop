import type { RigsyncContext } from '../../context'
import type { PlanAction } from '../../plan'
import { planApt } from './apt'
import { planFlatpak } from './flatpak'
import { planSnap } from './snap'
import type { PackageProviders } from './providerTypes'
import type { PackagesDiffReport } from './types'

export function planPackages(
  ctx: RigsyncContext,
  providers: PackageProviders,
  diff: PackagesDiffReport
): PlanAction[] {
  return [
    ...planApt(ctx, providers.apt, diff.apt),
    ...planSnap(diff.snap),
    ...planFlatpak(providers.flatpak, diff.flatpak)
  ]
}
