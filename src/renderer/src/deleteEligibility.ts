import { deleteDisabledReasonCopy } from './copy'
import type { SyncItemCapability, SyncItemGroupDto, SyncItemState } from '../../shared/ipc'

/**
 * 항목 삭제(uninstall, 안전 불변식 5) 순수 로직 — 3상태 컨트롤(SyncItemsView)과
 * 일괄 삭제 체크리스트(BulkDeleteChecklistDialog) 둘 다 이 판정 하나만 쓴다.
 *
 * 이 판정은 engine `planUninstall`을 부르지 않고 클라이언트에서 즉시 계산한다
 * — `buildPackageSyncGroups` 등 candidates 빌더의 항목 목록이 이미
 * `union(managed, live)`이라(engine/syncItems.ts 참조), `managed===false`인
 * 항목은 목록에 들어있다는 사실 자체가 "이 머신에 실제로 설치돼 있음"을
 * 증명한다 — 그래서 여기서 별도로 "설치 여부"를 조회할 필요가 없다. 최종
 * 확인은 그래도 `engine:planUninstall`의 dry-run이 한 번 더 검증한다(엔진이
 * 거부하면 excluded로 정직하게 보여준다 — 이 클라이언트 판정은 어디까지나
 * "삭제 버튼을 누를 수 있게 할지"를 빠르게 정하는 1차 필터일 뿐이다).
 */

/** engine/uninstall/index.ts의 switch 케이스와 1:1 대응 — 나머지는 전부 default(미지원). */
export const UNINSTALL_SUPPORTED_CAPABILITIES: readonly SyncItemCapability[] = [
  'dotfiles',
  'apt',
  'flatpak',
  'binaries',
  'fonts'
]

export function isUninstallSupportedCapability(capability: SyncItemCapability): boolean {
  return (UNINSTALL_SUPPORTED_CAPABILITIES as readonly string[]).includes(capability)
}

export interface DeleteEligibilityInput {
  readonly capability: SyncItemCapability
  readonly managed: boolean
  readonly ignored: boolean
  readonly detectionOnly: boolean
}

export interface DeleteEligibility {
  readonly eligible: boolean
  /** eligible이 false일 때만 채워지는, 사람이 읽는 비활성 사유. */
  readonly reason?: string
}

/**
 * 판정 순서: detectionOnly(snap) -> capability 미지원 -> managed(아직
 * manifest에 있음) -> not-paused(아직 ignore 안 됨) -> 그 외엔 eligible.
 * 이 순서는 engine `planUninstall`의 거부 우선순위(managed 우선, 그다음
 * ignore 여부)와 같은 순서를 따른다 — 사유가 하나만 필요하므로 가장 근본적인
 * 이유부터 검사한다.
 */
export function computeDeleteEligibility(item: DeleteEligibilityInput): DeleteEligibility {
  if (item.detectionOnly) {
    return { eligible: false, reason: deleteDisabledReasonCopy.detectionOnly }
  }
  if (!isUninstallSupportedCapability(item.capability)) {
    return {
      eligible: false,
      reason: deleteDisabledReasonCopy.unsupportedCapability(item.capability)
    }
  }
  if (item.managed) {
    return { eligible: false, reason: deleteDisabledReasonCopy.stillManaged }
  }
  if (!item.ignored) {
    return { eligible: false, reason: deleteDisabledReasonCopy.notPaused }
  }
  return { eligible: true }
}

/** 4상태(SyncItemState)만 있고 detectionOnly를 모르는 호출부를 위한 편의 오버로드. */
export function isDeletableState(state: SyncItemState): boolean {
  return state === 'excluded'
}

export interface DeletableItem {
  readonly capability: SyncItemCapability
  readonly key: string
  readonly label: string
  readonly description?: string
}

/**
 * 일괄 삭제 툴바 버튼 노출 여부·체크리스트 기본 목록을 위한 전체 스캔 —
 * 검색 필터와 무관하게 항상 전체 groups를 대상으로 한다(그룹 헤더 집계와
 * 같은 원칙 — R6 R1).
 */
export function collectDeletableItems(
  groups: readonly SyncItemGroupDto[]
): readonly DeletableItem[] {
  const out: DeletableItem[] = []
  for (const group of groups) {
    const detectionOnly = !!group.detectionOnly
    for (const item of group.items) {
      const eligibility = computeDeleteEligibility({
        capability: group.capability,
        managed: item.managed,
        ignored: item.ignored,
        detectionOnly
      })
      if (eligibility.eligible) {
        out.push({
          capability: group.capability,
          key: item.key,
          label: item.label,
          ...(item.description ? { description: item.description } : {})
        })
      }
    }
  }
  return out
}

/** 3상태 컨트롤의 persisted value — Delete는 지속 상태가 아니라 1회성 행동이라 값에 없다. */
export type CandidateControlValue = 'sync' | 'pause'

export function controlValueForItem(ignored: boolean): CandidateControlValue {
  return ignored ? 'pause' : 'sync'
}
