/**
 * "동기화 항목" 화면(P2a 결정 ⑤) — capability별 SyncItemGroup을 한데 모으고,
 * 화면의 ignore 토글 하나를 어느 ignore.toml `[capability] kind`로 쓸지
 * 해석한다. dotfiles(homes)/apt·snap(packages)/flatpak(apps) — 구 repo
 * ignore.toml 스키마의 kind 이름을 그대로 따른다.
 */
import { buildAppimageSyncGroup } from './capabilities/appimage/candidates'
import type { GearLeverProvider } from './capabilities/appimage/providerTypes'
import { buildBinariesSyncGroup } from './capabilities/binaries/candidates'
import { buildDotfilesSyncGroup } from './capabilities/dotfiles/syncItems'
import { buildFontsSyncGroup } from './capabilities/fonts/candidates'
import { buildPackageSyncGroups } from './capabilities/packages/candidates'
import { readEffectivePackages } from './capabilities/packages/io'
import type { PackageProviders } from './capabilities/packages/providerTypes'
import { buildReposSyncGroup } from './capabilities/repos/candidates'
import type { GitProvider } from './capabilities/repos/providerTypes'
import { buildServicesSyncGroup } from './capabilities/services/syncItems'
import { buildToolsSyncGroup } from './capabilities/tools/candidates'
import type { ToolsProvider } from './capabilities/tools/providerTypes'
import type { RigsyncContext } from './context'
import {
  applyAptDistroToggle,
  setIgnored,
  setIgnoredBulk,
  type AptDistroToggleItem
} from './ignore'

export interface SyncItem {
  readonly key: string
  readonly label: string
  /** manifest(effective)에 있으면 true — 실제로 동기화 대상이라는 뜻. */
  readonly managed: boolean
  readonly ignored: boolean
  /**
   * refactor-spec-v0.2 §1: apt "배포판 기본" 판정 항목의 include 예외 여부 —
   * 켜져 있으면 배포판 판정이어도 다음 Capture가 manifest에 담는다.
   * apt 그룹에서만 채워진다 (다른 capability엔 분류 개념이 없음).
   */
  readonly included?: boolean
  /**
   * R6 R2: 항목이 무엇인지 사람이 읽는 한 줄 — apt(Description-en)/
   * flatpak(name+description)/appimage(Gear Lever `name`)/dotfiles(잘 알려진
   * 경로 사전)/repos(remote URL) capability별 provider 조회 결과. 조회 실패·
   * 미지원(snap/tools 등)이면 undefined — 추측으로 채우지 않는다.
   */
  readonly description?: string
  /**
   * F2(docs/refactor-spec-v0.2.md): 이 항목이 지금 이 머신의 host 계층에
   * 있으면 true — dotfiles·services 그룹만 채운다(`HOST_LAYER_CAPABILITIES`,
   * shared/ipc.ts). 다른 capability는 host 계층 이동 개념이 없어 항상 undefined.
   */
  readonly hostOnly?: boolean
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
 * - detected: detection-only 그룹(snap) 소속 항목의 유일한 상태. 이 네 상태는
 *   전부 "다음 Capture가 manifest를 어떻게 바꿀지"를 말하는데, snap은 plan/apply
 *   에서 완전히 빠져있어(`SyncItemGroup.detectionOnly`, FORWARD.md §7) 그 질문
 *   자체가 성립하지 않는다 — managed×ignored를 그대로 4상태에 태우면 "동기화
 *   대상이 아님"이라 적어둔 그룹이 "추가 예정"을 말하는 자기모순이 생긴다
 *   (R7 코디네이터 스크린샷 발견). `computeSyncItemState`는 그래서 이 상태를
 *   모른다 — 소비 지점(`withSyncItemState`)이 그룹의 `detectionOnly` 플래그를
 *   보고 이 단일 상태로 덮어쓴다.
 */
/**
 * refactor-spec-v0.2 §1이 더한 여섯째 상태 `distro-default`: apt "배포판 기본"
 * 그룹의 미관리·미포함(include 안 됨) 항목. `excluded`(사용자가 ignore로 명시
 * 제외)와 달리 **분류가** 제외한 안정 상태다 — 스위치를 켜면 include 예외가
 * 되어 pending-add로 간다. 4상태에 욱여넣지 않는 이유는 snap의 `detected`와
 * 같은 구조: 이 그룹에선 "다음 Capture가 뭘 할 것인가"의 답이 managed×ignored
 * 만으로 안 나온다(include가 셋째 축 — `withSyncItemState`가 그룹의
 * `subgroup: 'apt-distro'`를 보고 별도 계산).
 */
export type SyncItemState =
  'synced' | 'pending-add' | 'pending-remove' | 'excluded' | 'detected' | 'distro-default'

export function computeSyncItemState(
  item: Pick<SyncItem, 'managed' | 'ignored'>
): Exclude<SyncItemState, 'detected' | 'distro-default'> {
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
  readonly capability:
    | 'dotfiles'
    | 'apt'
    | 'snap'
    | 'flatpak'
    | 'appimage'
    | 'fonts'
    | 'binaries'
    | 'tools'
    | 'repos'
    /**
     * F2(docs/refactor-spec-v0.2.md): "이 머신 전용" 전환을 보여주기 위한
     * 그룹 — dotfiles와 달리 unmanaged 후보 탐지·ignore가 없다(항목은 전부
     * managed=true·ignored=false, `capabilities/services/syncItems.ts` 참조).
     */
    | 'services'
  readonly title: string
  readonly items: readonly SyncItem[]
  /**
   * P2c 결정 ②: snap은 동기화 plan/apply에서 빠졌다(정책 §7 비목표) — 이
   * 화면에 여전히 나오는 건 INV-1 중복 검출을 위한 조회일 뿐, ignore 토글을
   * 눌러도 apply에 아무 영향이 없다는 걸 이 플래그로 표시한다.
   */
  readonly detectionOnly?: boolean
  /**
   * refactor-spec-v0.2 §1: apt는 무상태 분류로 두 그룹으로 갈라진다 —
   * `apt-user`(사용자 설치)와 `apt-distro`(배포판 기본, 접힌 그룹). 상태
   * 계산(`withSyncItemState`)과 토글 라우팅(`toggleSyncItemIgnore*`)이 이
   * 값으로 갈린다. 없으면 기존 단일 그룹 의미론 그대로.
   */
  readonly subgroup?: 'apt-user' | 'apt-distro'
  /** UI가 처음에 접어서 보여줄 그룹 (펼치기 가능 — 절대 숨기지 않는다, 스펙 판단 원칙 2). */
  readonly collapsedByDefault?: boolean
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
 *
 * R7: `detectionOnly` 그룹(snap)의 항목은 managed×ignored 4상태를 계산하지
 * 않고 전부 `detected`로 덮어쓴다 — 위 `SyncItemState` 주석 참조.
 */
/**
 * apt-distro 그룹 전용 상태 계산 — managed×ignored 위에 include가 셋째 축.
 * managed 항목은 일반 의미론과 같고(ignore가 제거를 결정), 미관리 항목만
 * include가 pending-add ↔ distro-default를 가른다.
 */
function computeDistroItemState(
  item: Pick<SyncItem, 'managed' | 'ignored' | 'included'>
): SyncItemState {
  if (item.managed) return item.ignored ? 'pending-remove' : 'synced'
  return item.included ? 'pending-add' : 'distro-default'
}

export function withSyncItemState(
  groups: readonly SyncItemGroup[]
): readonly SyncItemGroupWithState[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      state: group.detectionOnly
        ? ('detected' as const)
        : group.subgroup === 'apt-distro'
          ? computeDistroItemState(item)
          : computeSyncItemState(item)
    }))
  }))
}

const IGNORE_KIND_BY_CAPABILITY: Readonly<Record<SyncItemGroup['capability'], string>> = {
  dotfiles: 'homes',
  apt: 'packages',
  snap: 'packages',
  flatpak: 'apps',
  appimage: 'names',
  fonts: 'names',
  binaries: 'names',
  tools: 'packages',
  repos: 'paths',
  // services는 ignore 메커니즘이 없다(captureServices가 ignore.toml을 전혀
  // 참조하지 않음) — 이 값은 그래서 UI에서 절대 안 쓰인다(렌더러가
  // `isIgnoreUnsupportedCapability`로 이 그룹의 ignore 토글 자체를
  // 비활성화한다, shared/ipc.ts 참조). Record의 모든 capability 키를 채워야
  // 하는 타입 요구 때문에 자리만 채운 값이다.
  services: 'names'
}

export async function listSyncItemGroups(
  ctx: RigsyncContext,
  providers: PackageProviders,
  gearLeverProvider: GearLeverProvider,
  toolsProvider: ToolsProvider,
  gitProvider: GitProvider
): Promise<SyncItemGroup[]> {
  const dotfilesGroup = buildDotfilesSyncGroup(ctx)
  const servicesGroup = buildServicesSyncGroup(ctx)
  const packageGroups = await buildPackageSyncGroups(ctx, providers)
  const appimageGroup = await buildAppimageSyncGroup(ctx, gearLeverProvider)
  const fontsGroup = await buildFontsSyncGroup(ctx)
  const binariesGroup = await buildBinariesSyncGroup(ctx)
  const toolsGroup = await buildToolsSyncGroup(ctx, toolsProvider)
  const reposGroup = await buildReposSyncGroup(ctx, gitProvider)
  return [
    ...(dotfilesGroup ? [dotfilesGroup] : []),
    ...(servicesGroup ? [servicesGroup] : []),
    ...packageGroups,
    ...(appimageGroup ? [appimageGroup] : []),
    ...(fontsGroup ? [fontsGroup] : []),
    ...(binariesGroup ? [binariesGroup] : []),
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

/**
 * refactor-spec-v0.2 §1: "배포판 기본" 그룹의 스위치는 ignore가 아니라
 * include 예외를 움직인다(managed 항목만 ignore 의미론 유지 —
 * `applyAptDistroToggle` 주석 참조). 각 키의 managed 여부는 renderer가 보낸
 * 상태를 믿지 않고 여기서 manifest(effective)로 다시 판정한다.
 */
export function toggleAptDistroSyncedBulk(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId' | 'profile'>,
  keys: readonly string[],
  synced: boolean
): void {
  const managedSet = new Set(readEffectivePackages(ctx).apt?.packages ?? [])
  const items: AptDistroToggleItem[] = keys.map((key) => ({
    key,
    managed: managedSet.has(key)
  }))
  applyAptDistroToggle(ctx, items, synced)
}
