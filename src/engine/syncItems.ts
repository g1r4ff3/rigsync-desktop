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
import type { GitProvider } from './capabilities/repos/providerTypes'
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
  /**
   * R6 R2: 항목이 무엇인지 사람이 읽는 한 줄 — apt(Description-en)/
   * flatpak(name+description)/appimage(Gear Lever `name`)/dotfiles(잘 알려진
   * 경로 사전)/repos(remote URL) capability별 provider 조회 결과. 조회 실패·
   * 미지원(snap/tools 등)이면 undefined — 추측으로 채우지 않는다.
   */
  readonly description?: string
}

/**
 * R6 R1: Candidates 화면 4상태 모델 — managed × ignored 조합이 실제로 뜻하는
 * 바를 이름 붙인다. 코드 확인 결과(`ignore.ts`의 `setIgnored` 주석 + capture의
 * additive-only 계약): ignore 토글은 manifest를 **즉시** 바꾸지 않는다 —
 * common ignore.toml만 갱신하고, 실제 manifest 반영(추가/제거)은 다음
 * Capture 때 일어난다. 그래서 managed(지금 manifest 상태)와 ignored(다음
 * capture가 향할 방향)가 어긋날 때가 "보류 중"이다.
 *
 * - synced: managed && !ignored — 지금 동기화 대상이고 계속 그럴 것.
 * - pending-add: !managed && !ignored — 아직 manifest엔 없지만 다음 Capture가
 *   (additive-only 규칙에 따라) 새로 담을 것.
 * - pending-remove: managed && ignored — 지금은 manifest에 있지만 ignore가
 *   켜졌으니 다음 Capture가 additive-only의 유일한 예외로 제거할 것.
 * - excluded: !managed && ignored — manifest에도 없고 ignore돼 있어 다음
 *   Capture도 담지 않을 안정 상태.
 */
export type SyncItemState = 'synced' | 'pending-add' | 'pending-remove' | 'excluded'

export function computeSyncItemState(item: Pick<SyncItem, 'managed' | 'ignored'>): SyncItemState {
  if (item.managed && !item.ignored) return 'synced'
  if (!item.managed && !item.ignored) return 'pending-add'
  if (item.managed && item.ignored) return 'pending-remove'
  return 'excluded'
}

/** pending-add/pending-remove 둘 다 "다음 Capture가 오면 바뀐다"는 공통 성질을 갖는다. */
export function isPendingSyncItemState(state: SyncItemState): boolean {
  return state === 'pending-add' || state === 'pending-remove'
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

export interface SyncItemWithState extends SyncItem {
  readonly state: SyncItemState
}

export interface SyncItemGroupWithState extends Omit<SyncItemGroup, 'items'> {
  readonly items: readonly SyncItemWithState[]
}

/**
 * `listSyncItemGroups`의 순수 결과에 `state`를 얹는 후처리 단계 — 이렇게
 * 갈라두면 `listSyncItemGroups` 자체의 반환 shape·기존 테스트(정확히
 * {key,label,managed,ignored}만 기대)는 그대로 두고, IPC 경계(main/ipc.ts)에서만
 * 이 함수로 감싸 renderer DTO에 `state`를 실어 보낸다.
 */
export function withSyncItemState(
  groups: readonly SyncItemGroup[]
): readonly SyncItemGroupWithState[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, state: computeSyncItemState(item) }))
  }))
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
  toolsProvider: ToolsProvider,
  gitProvider: GitProvider
): Promise<SyncItemGroup[]> {
  const dotfilesGroup = buildDotfilesSyncGroup(ctx)
  const packageGroups = await buildPackageSyncGroups(ctx, providers)
  const appimageGroup = await buildAppimageSyncGroup(ctx, gearLeverProvider)
  const toolsGroup = await buildToolsSyncGroup(ctx, toolsProvider)
  const reposGroup = await buildReposSyncGroup(ctx, gitProvider)
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
