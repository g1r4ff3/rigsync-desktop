import type { RigsyncContext } from '../../context'
import { diffApt } from './apt'
import { diffFlatpak } from './flatpak'
import { diffSnap } from './snap'
import type { PackageProviders } from './providerTypes'
import type { PackagesDiffReport } from './types'

export async function diffPackages(
  ctx: RigsyncContext,
  providers: PackageProviders
): Promise<PackagesDiffReport> {
  const apt = await diffApt(ctx, providers.apt)
  const snap = await diffSnap(ctx, providers.snap)
  const flatpak = await diffFlatpak(ctx, providers.flatpak)
  return { capability: 'packages', apt, snap, flatpak }
}
