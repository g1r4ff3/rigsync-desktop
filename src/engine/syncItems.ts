/**
 * "동기화 항목" 화면(P2a 결정 ⑤) — capability별 SyncItemGroup을 한데 모으고,
 * 화면의 ignore 토글 하나를 어느 ignore.toml `[capability] kind`로 쓸지
 * 해석한다. dotfiles(homes)/apt·snap(packages)/flatpak(apps) — 구 repo
 * ignore.toml 스키마의 kind 이름을 그대로 따른다.
 */
import { buildDotfilesSyncGroup } from './capabilities/dotfiles/syncItems'
import { buildPackageSyncGroups } from './capabilities/packages/candidates'
import type { PackageProviders } from './capabilities/packages/providerTypes'
import type { RigsyncContext } from './context'
import { setIgnored } from './ignore'

export interface SyncItem {
  readonly key: string
  readonly label: string
  /** manifest(effective)에 있으면 true — 실제로 동기화 대상이라는 뜻. */
  readonly managed: boolean
  readonly ignored: boolean
}

export interface SyncItemGroup {
  readonly capability: 'dotfiles' | 'apt' | 'snap' | 'flatpak'
  readonly title: string
  readonly items: readonly SyncItem[]
}

const IGNORE_KIND_BY_CAPABILITY: Readonly<Record<SyncItemGroup['capability'], string>> = {
  dotfiles: 'homes',
  apt: 'packages',
  snap: 'packages',
  flatpak: 'apps'
}

export async function listSyncItemGroups(
  ctx: RigsyncContext,
  providers: PackageProviders
): Promise<SyncItemGroup[]> {
  const dotfilesGroup = buildDotfilesSyncGroup(ctx)
  const packageGroups = await buildPackageSyncGroups(ctx, providers)
  return dotfilesGroup ? [dotfilesGroup, ...packageGroups] : packageGroups
}

export function toggleSyncItemIgnore(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  capability: SyncItemGroup['capability'],
  key: string,
  ignored: boolean
): void {
  setIgnored(ctx, capability, IGNORE_KIND_BY_CAPABILITY[capability], key, ignored)
}
