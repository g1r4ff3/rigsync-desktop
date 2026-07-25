/**
 * "동기화 항목" 화면(P2a 결정 ⑤) — capability별 SyncItemGroup을 한데 모으고,
 * 화면의 ignore 토글 하나를 어느 ignore.toml `[capability] kind`로 쓸지
 * 해석한다. dotfiles(homes)/apt·snap(packages)/flatpak(apps) — 구 repo
 * ignore.toml 스키마의 kind 이름을 그대로 따른다.
 */
import { buildAppimageSyncGroup } from './capabilities/appimage/candidates'
import type { GearLeverProvider } from './capabilities/appimage/providerTypes'
import { buildDotfilesSyncGroup } from './capabilities/dotfiles/syncItems'
import { buildPackageSyncGroups } from './capabilities/packages/candidates'
import type { PackageProviders } from './capabilities/packages/providerTypes'
import { buildReposSyncGroup } from './capabilities/repos/candidates'
import { buildToolsSyncGroup } from './capabilities/tools/candidates'
import type { ToolsProvider } from './capabilities/tools/providerTypes'
import type { RigsyncContext } from './context'
import { setIgnored, setIgnoredBulk } from './ignore'

export interface SyncItem {
  readonly key: string
  readonly label: string
  /** manifest(effective)에 있으면 true — 실제로 동기화 대상이라는 뜻. */
  readonly managed: boolean
  readonly ignored: boolean
}

export interface SyncItemGroup {
  readonly capability: 'dotfiles' | 'apt' | 'snap' | 'flatpak' | 'appimage' | 'tools' | 'repos'
  readonly title: string
  readonly items: readonly SyncItem[]
  /**
   * P2c 결정 ②: snap은 동기화 plan/apply에서 빠졌다(정책 §7 비목표) — 이
   * 화면에 여전히 나오는 건 INV-1 중복 검출을 위한 조회일 뿐, ignore 토글을
   * 눌러도 apply에 아무 영향이 없다는 걸 이 플래그로 표시한다.
   */
  readonly detectionOnly?: boolean
}

const IGNORE_KIND_BY_CAPABILITY: Readonly<Record<SyncItemGroup['capability'], string>> = {
  dotfiles: 'homes',
  apt: 'packages',
  snap: 'packages',
  flatpak: 'apps',
  appimage: 'names',
  tools: 'packages',
  repos: 'paths'
}

export async function listSyncItemGroups(
  ctx: RigsyncContext,
  providers: PackageProviders,
  gearLeverProvider: GearLeverProvider,
  toolsProvider: ToolsProvider
): Promise<SyncItemGroup[]> {
  const dotfilesGroup = buildDotfilesSyncGroup(ctx)
  const packageGroups = await buildPackageSyncGroups(ctx, providers)
  const appimageGroup = await buildAppimageSyncGroup(ctx, gearLeverProvider)
  const toolsGroup = await buildToolsSyncGroup(ctx, toolsProvider)
  const reposGroup = await buildReposSyncGroup(ctx)
  return [
    ...(dotfilesGroup ? [dotfilesGroup] : []),
    ...packageGroups,
    ...(appimageGroup ? [appimageGroup] : []),
    ...(toolsGroup ? [toolsGroup] : []),
    ...(reposGroup ? [reposGroup] : [])
  ]
}

export function toggleSyncItemIgnore(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  capability: SyncItemGroup['capability'],
  key: string,
  ignored: boolean
): void {
  setIgnored(ctx, capability, IGNORE_KIND_BY_CAPABILITY[capability], key, ignored)
}

/** R5: Candidates 그룹 전체 토글 — 항목 수만큼 반복 호출하지 않고 1회 읽기/쓰기로. */
export function toggleSyncItemIgnoreBulk(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  capability: SyncItemGroup['capability'],
  keys: readonly string[],
  ignored: boolean
): void {
  setIgnoredBulk(ctx, capability, IGNORE_KIND_BY_CAPABILITY[capability], keys, ignored)
}
