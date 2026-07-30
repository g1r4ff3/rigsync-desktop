import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, PackageMinus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { BulkDeleteChecklistDialog } from '@/components/BulkDeleteChecklistDialog'
import { CandidateStateControl } from '@/components/CandidateStateControl'
import { CandidateStateIcon } from '@/components/CandidateStateIcon'
import { CaptureReportSummary } from '@/components/CaptureReportSummary'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { RegisterDotfileDialog } from '@/components/RegisterDotfileDialog'
import { UnregisterConfirmDialog } from '@/components/UnregisterConfirmDialog'
import { ViewToolbar } from '@/components/ViewToolbar'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { captureAll, revalidateAfterCapture, type CaptureAllReport } from '../captureAll'
import {
  addDotfileButtonCopy,
  bulkDeleteCopy,
  bulkSubscribeCopy,
  buttonCopy,
  candidatesIntroCopy,
  describeSyncItemState,
  emptyStateCopy,
  formatDetectionOnlySummary,
  formatSyncItemStateSummary,
  hostLayerToggleCopy,
  pendingChangesCopy,
  registerActionCopy,
  selectionModeCopy,
  shouldShowPendingCaptureBanner,
  subscribeToggleCopy,
  toggleDisabledReason,
  unregisterActionCopy
} from '../copy'
import {
  collectDeletableItems,
  computeDeleteEligibility,
  controlValueForItem,
  type DeletableItem
} from '../deleteEligibility'
import {
  computeSubscribeGroupState,
  isSubscribeEligible,
  nextBulkSubscribedValue,
  showsRegisterButton,
  showsUnregisterButton,
  subscribeEligibleKeys,
  type SubscribeGroupState
} from '../registryUiHelpers'
import { SCREENSHOT_GOTO_EVENT } from '../screenshotBus'
import { StatusText } from '../status'
import {
  fetchSyncItemsSnapshot,
  syncItemsSnapshotSlot,
  useSyncItemsSnapshot
} from '../syncItemsSnapshotStore'
import {
  isHostLayerCapability,
  isIgnoreUnsupportedCapability,
  type EngineStatus,
  type HostLayerCapability,
  type RegisterCapability,
  type ScreenshotRoute,
  type SyncItemGroupDto,
  type SyncItemState
} from '../../../shared/ipc'

/**
 * "동기화 항목" 화면(P2a 결정 ⑤, R3부터 탭 이름은 "Candidates") — managed
 * (manifest)/unmanaged(설치는 됐지만 미기록) 항목을 provider·capability별로
 * 나열하고, 스위치로 ignore를 토글한다. apt 하나만도 족히 100개가 넘어갈 수
 * 있어(구 GTK GUI의 실제 약점) 검색 필터 + `@tanstack/react-virtual` 가상
 * 스크롤이 필수다.
 *
 * R5: 그룹 헤더에 전체 토글을 추가한다 — 그룹의 "동기화 대상" 여부를 한 번에
 * 맞춘다(체크 = 전부 동기화 대상/= 아무것도 ignore 안 됨, 해제 = 전부
 * ignore). 항상 **그룹 전체**(현재 검색 필터로 가려진 항목 포함)를 대상으로
 * 하고, 반드시 배치 IPC(`toggleIgnoreBulk`) 하나로 처리한다 — 항목별 루프로
 * 얹으면 자동 commit+push가 항목 수만큼 쌓이는 커밋 폭탄이 된다(main/ipc.ts
 * 주석 참조).
 *
 * R6 R1: managed(manifest 상태) 하나만으로는 "내가 고른 스위치가 실제로
 * 반영됐는지"가 안 보였다(ignore는 즉시 manifest를 안 바꾸고 다음 Capture
 * 때 반영 — engine `computeSyncItemState` 참조). 그래서 항목마다
 * managed×ignored 4상태(synced/pending-add/pending-remove/excluded)를 아이콘+
 * 라벨로 보여주고, 보류 중(pending-*)이 하나라도 있으면 배너로 Capture를
 * 안내한다(State 층 — "다음 행동 안내").
 *
 * R4 스코프 결정: 개별 항목 스위치(수백 개까지 가는 가상 스크롤 목록)는
 * shadcn Tooltip을 안 쓰고 네이티브 `title` 속성만 쓴다 — 행마다 Radix
 * Portal을 띄우면 가상 스크롤 성능이 떨어진다. 구조적 컨트롤(검색창·그룹
 * 체크박스·상단 배너)에는 shadcn Tooltip/ActionButton을 쓴다.
 *
 * R7: detection-only 그룹(snap)은 위 4상태 모델에 태우지 않는다 — 코디네이터가
 * 스크린샷에서 짚은 자기모순("검출 전용" 헤더인데 우측 집계는 "추가 예정",
 * 스위치도 전부 켜짐) 수정. engine이 이미 이 그룹의 모든 항목을 `detected`
 * 단일 상태로 덮어써서 보내주므로(`withSyncItemState`), 이 화면은 그 그룹을
 * stateCounts가 아니라 `detectedCount` 하나로 집계하고, 화면 상단 전체 집계·
 * 보류 배너 계산에서도 제외한다. 스위치·그룹 체크박스는 실제 효과가 없다는
 * 걸 코드로 확인했으므로(copy.ts `detectionOnlyDisabledReason` 참조) 비활성화.
 */

type GroupToggleState = 'all-synced' | 'all-ignored' | 'mixed'

interface StateCounts {
  readonly synced: number
  readonly pendingAdd: number
  readonly pendingRemove: number
  readonly excluded: number
  /** refactor-spec-v0.2 §1: apt-distro 그룹에서만 0이 아닐 수 있다. */
  readonly distroDefault: number
  /**
   * v0.1.20 4번: appimage 전용 — capture가 담을 수 없는 항목. `pendingAdd`와
   * 겉보기 조건은 같지만 별도 버킷이다(engine `computeSyncItemState` 참조) —
   * 그래서 위 "보류 중인 변경" 배너·pendingCount(아래)에서 자동으로 빠진다.
   */
  readonly unresolvable: number
}

const EMPTY_STATE_COUNTS: StateCounts = {
  synced: 0,
  pendingAdd: 0,
  pendingRemove: 0,
  excluded: 0,
  distroDefault: 0,
  unresolvable: 0
}

type Row =
  | {
      readonly kind: 'header'
      readonly key: string
      readonly title: string
      readonly capability: SyncItemGroupDto['capability']
      /**
       * refactor-spec-v0.2 §1: apt가 두 그룹(apt-user/apt-distro)으로 갈라져
       * capability만으로는 그룹이 유일하지 않다 — 접기/busy 상태의 키는 이걸 쓴다.
       */
      readonly groupId: string
      readonly subgroup?: SyncItemGroupDto['subgroup']
      readonly detectionOnly: boolean
      /** 접힌 상태(기본 collapsedByDefault, 사용자가 펼치면 해제 — 검색 중엔 항상 펼침). */
      readonly collapsed: boolean
      readonly groupState: GroupToggleState
      /** 그룹 전체 항목의 key 목록(검색 필터와 무관 — 그룹 토글은 항상 전체 대상). */
      readonly allItemKeys: readonly string[]
      /**
       * 검색 필터와 무관하게 그룹 전체를 센 값(집계는 항상 전체 대상 — R6 R1).
       * R7: detectionOnly 그룹은 4상태 집계가 성립하지 않으므로 `detectedCount`만
       * 채우고 이건 전부 0인 채로 둔다(렌더 쪽에서 detectionOnly면 이 필드를
       * 안 쓴다 — 둘 다 갖고 있게 해 타입을 단순하게 유지).
       */
      readonly stateCounts: StateCounts
      /** R7: detectionOnly 그룹 전용 집계 — 비-detectionOnly 그룹은 항상 0. */
      readonly detectedCount: number
      /**
       * WS3("창고 모델" 구독) — 그룹 단위 "모두 구독/해제" 버튼의 상태. 구독
       * 개념이 성립하는 항목(managed && !ignored)이 하나도 없으면 null이고,
       * 그 경우 버튼 자체를 숨긴다(registryUiHelpers `computeSubscribeGroupState`).
       */
      readonly subscribeGroupState: SubscribeGroupState | null
      /** 위 버튼이 벌크 토글할 대상 key 목록(검색 필터 무관 — 항상 그룹 전체). */
      readonly subscribeKeys: readonly string[]
      /**
       * WS6("창고 모델 1차"): dotfiles capability의 **첫** 헤더 행(main
       * 그룹이 있으면 main, SEED 강등으로 본체가 비어 없으면 suggested
       * 그룹)에만 true — "Add file/folder" 버튼이 항상 정확히 한 곳에만
       * 뜨게 한다(두 그룹 헤더 모두에 중복해서 달지 않는다).
       */
      readonly showAddDotfileButton: boolean
    }
  | {
      readonly kind: 'item'
      readonly key: string
      readonly capability: SyncItemGroupDto['capability']
      readonly subgroup?: SyncItemGroupDto['subgroup']
      readonly itemKey: string
      readonly label: string
      readonly description?: string
      readonly managed: boolean
      readonly ignored: boolean
      readonly included: boolean
      readonly state: SyncItemState
      /** R7: 소속 그룹이 detectionOnly면 스위치를 비활성화한다. */
      readonly detectionOnly: boolean
      /** computeDeleteEligibility 결과를 행 생성 시점에 미리 계산해 둔다. */
      readonly deleteEligible: boolean
      readonly deleteDisabledReason?: string
      /**
       * F2(docs/refactor-spec-v0.2.md): 이 항목이 지금 이 머신의 host 계층에
       * 있는지 — `isHostLayerCapability(capability)`인 그룹(dotfiles·services)
       * 에서만 의미가 있다(다른 그룹은 항상 false).
       */
      readonly hostOnly: boolean
      /**
       * v0.1.20 4번: state가 'unresolvable'일 때만 채워지는, capture가 이
       * 항목을 담지 못하는 구체적 사유(appimage 전용, SyncItemGroupDto
       * `unresolvableReason` 그대로) — 행에 직접 보여준다(사유 표시).
       */
      readonly unresolvableReason?: string
    }

/**
 * 항목의 스위치가 "켜짐(동기화 대상)"인지 — 일반 그룹은 !ignored 하나로
 * 충분하지만, apt-distro 그룹의 미관리 항목은 include 예외가 켜짐을 뜻한다
 * (engine `computeDistroItemState`와 같은 축 — refactor-spec-v0.2 §1).
 */
function isItemOn(
  item: Pick<SyncItemGroupDto['items'][number], 'managed' | 'ignored' | 'included'>,
  subgroup: SyncItemGroupDto['subgroup']
): boolean {
  if (subgroup === 'apt-distro' && !item.managed) return !!item.included
  return !item.ignored
}

function computeGroupState(
  items: SyncItemGroupDto['items'],
  subgroup: SyncItemGroupDto['subgroup']
): GroupToggleState {
  if (items.length === 0) return 'all-synced'
  const onCount = items.filter((i) => isItemOn(i, subgroup)).length
  if (onCount === items.length) return 'all-synced'
  if (onCount === 0) return 'all-ignored'
  return 'mixed'
}

/**
 * R7: 상태 집계 — detectionOnly 그룹(항목이 전부 `detected`)에는 호출하지
 * 않는다(호출부는 `detectedCount`를 쓴다). `detected`를 여기 섞으면 else
 * 분기가 그걸 `excluded`로 잘못 세므로, 안전하게 명시 분기로 막아둔다.
 */
function computeStateCounts(items: SyncItemGroupDto['items']): StateCounts {
  return items.reduce((acc, item) => {
    if (item.state === 'synced') return { ...acc, synced: acc.synced + 1 }
    if (item.state === 'pending-add') return { ...acc, pendingAdd: acc.pendingAdd + 1 }
    if (item.state === 'pending-remove') return { ...acc, pendingRemove: acc.pendingRemove + 1 }
    if (item.state === 'excluded') return { ...acc, excluded: acc.excluded + 1 }
    if (item.state === 'distro-default') return { ...acc, distroDefault: acc.distroDefault + 1 }
    if (item.state === 'unresolvable') return { ...acc, unresolvable: acc.unresolvable + 1 }
    return acc
  }, EMPTY_STATE_COUNTS)
}

function mergeStateCounts(groups: readonly StateCounts[]): StateCounts {
  return groups.reduce(
    (acc, c) => ({
      synced: acc.synced + c.synced,
      pendingAdd: acc.pendingAdd + c.pendingAdd,
      pendingRemove: acc.pendingRemove + c.pendingRemove,
      excluded: acc.excluded + c.excluded,
      distroDefault: acc.distroDefault + c.distroDefault,
      unresolvable: acc.unresolvable + c.unresolvable
    }),
    EMPTY_STATE_COUNTS
  )
}

/** WS3: SubscribeGroupState → bulkSubscribeCopy 키(문구 3종 매핑). */
function toBulkSubscribeCopyKey(state: SubscribeGroupState): 'allOn' | 'allOff' | 'mixed' {
  if (state === 'all-on') return 'allOn'
  if (state === 'all-off') return 'allOff'
  return 'mixed'
}

/** 그룹의 유일 식별자 — apt는 subgroup까지 필요(두 그룹), 나머지는 capability. */
function groupIdOf(group: SyncItemGroupDto): string {
  return group.subgroup ?? group.capability
}

function groupCheckboxLabel(
  state: GroupToggleState,
  subgroup?: SyncItemGroupDto['subgroup']
): string {
  // refactor-spec-v0.2 §1: apt-distro 그룹의 스위치는 ignore가 아니라 include
  // 예외를 움직이므로 문구도 그 의미로 말한다(real-world match).
  if (subgroup === 'apt-distro') {
    if (state === 'all-synced')
      return '전체 포함됨 — 클릭하면 그룹 전체의 include 예외를 해제합니다'
    if (state === 'all-ignored')
      return '전체 제외됨(배포판 기본) — 클릭하면 그룹 전체를 include 예외로 포함합니다'
    return '일부만 포함됨(혼합) — 클릭하면 그룹 전체를 include 예외로 포함합니다'
  }
  if (state === 'all-synced') return '전체 동기화 대상 — 클릭하면 그룹 전체를 ignore 처리합니다'
  if (state === 'all-ignored')
    return '전체 ignore됨 — 클릭하면 그룹 전체를 동기화 대상으로 되돌립니다'
  return '일부만 ignore됨(혼합) — 클릭하면 그룹 전체를 동기화 대상으로 되돌립니다'
}

/**
 * 네이티브 checkbox는 `indeterminate`를 prop이 아니라 DOM 속성으로만 지원한다.
 * R7: `disabledReason`이 있으면(detectionOnly 그룹) 체크박스를 비활성화하고
 * 그 이유를 툴팁으로 보여준다 — 일반 그룹의 groupCheckboxLabel 문구는 안 쓴다
 * (동기화 대상이 아닌 그룹에 "ignore 처리합니다" 같은 문구를 다는 건 그 자체가
 * real-world match 위반).
 */
function GroupCheckbox({
  state,
  subgroup,
  disabled,
  disabledReason,
  onClick
}: {
  readonly state: GroupToggleState
  readonly subgroup?: SyncItemGroupDto['subgroup']
  readonly disabled: boolean
  readonly disabledReason?: string
  readonly onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <input
          type="checkbox"
          checked={state === 'all-synced'}
          disabled={disabled}
          ref={(el) => {
            if (el) el.indeterminate = state === 'mixed'
          }}
          onChange={onClick}
          aria-label="그룹 전체 토글"
        />
      </TooltipTrigger>
      <TooltipContent>{disabledReason ?? groupCheckboxLabel(state, subgroup)}</TooltipContent>
    </Tooltip>
  )
}

interface SyncItemsViewProps {
  readonly status: EngineStatus | null
  /**
   * WS7("창고 모델 1차"): 온보딩에서 "선택 구독"을 고르고 막 완료했을 때만
   * true — 그룹 체크박스·구독 Switch가 곧 피커라는 안내를 한 번 보여준다.
   */
  readonly showSelectionOnboardingHint?: boolean
  readonly onDismissSelectionOnboardingHint?: () => void
}

function SyncItemsView({
  status,
  showSelectionOnboardingHint,
  onDismissSelectionOnboardingHint
}: SyncItemsViewProps): React.JSX.Element {
  // 4단계(스냅샷 스토어): 탭 전환 체감 0ms — syncItemsSnapshotStore.ts 구독으로
  // 바꿨다(옛 주석 그대로: "이 화면은 탭이 바뀔 때마다 언마운트/재마운트되므로
  // 매번 listSyncItems()를 새로 기다려야 한다"던 지적을 여기서 해소한다).
  const syncItemsSnapshot = useSyncItemsSnapshot()
  const groups = syncItemsSnapshot.data
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({})
  const [pendingGroups, setPendingGroups] = useState<Record<string, boolean>>({})
  // F2: "이 머신 전용" 스위치 전용 busy 상태 — ignore 토글(pendingKeys)과는
  // 별개 컨트롤이라 같은 행에서 둘이 동시에 눌려도(이론상) 서로의 busy를
  // 밟지 않는다.
  const [pendingHostKeys, setPendingHostKeys] = useState<Record<string, boolean>>({})
  // WS3("창고 모델" 구독) — 구독 Switch·그룹 벌크 구독 버튼 전용 busy 상태
  // (ignore 토글 pendingKeys와는 별개 컨트롤이라 서로의 busy를 밟지 않는다,
  // pendingHostKeys와 같은 이유).
  const [pendingSubscribeKeys, setPendingSubscribeKeys] = useState<Record<string, boolean>>({})
  const [pendingSubscribeGroups, setPendingSubscribeGroups] = useState<Record<string, boolean>>({})
  // WS4("창고 모델" 등록) — Register 버튼 전용 busy 상태.
  const [pendingRegisterKeys, setPendingRegisterKeys] = useState<Record<string, boolean>>({})
  // WS4 "Remove from catalog" 확인 다이얼로그 상태 — DeleteConfirmDialog와 같은
  // "열 때마다 key를 올려 리마운트" 패턴.
  const [unregisterItem, setUnregisterItem] = useState<{
    readonly capability: RegisterCapability
    readonly key: string
    readonly label: string
  } | null>(null)
  const [unregisterSeq, setUnregisterSeq] = useState(0)
  // WS6("창고 모델 1차"): "Add file/folder" 다이얼로그 — 열 때마다 seq를
  // 올려 리마운트한다(다른 다이얼로그와 같은 패턴 — 이전 입력값이 새로 열 때
  // 남지 않게).
  const [registerDotfileOpen, setRegisterDotfileOpen] = useState(false)
  const [registerDotfileSeq, setRegisterDotfileSeq] = useState(0)
  // refactor-spec-v0.2 §1: 그룹 접기 상태 — 명시 오버라이드만 저장하고,
  // 없으면 그룹의 collapsedByDefault를 따른다(refresh로 groups가 갈려도
  // 사용자가 펼친 상태가 유지된다). 검색 중엔 접힘을 무시한다 — 접힌 그룹
  // 안의 매치가 소리 없이 숨는 것은 스펙 판단 원칙 2 위반.
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({})
  const [captureBusy, setCaptureBusy] = useState(false)
  // v0.1.20 1번: 마지막 Capture 결과 — DiffView와 같은 패턴(다음 Capture 시작 시 비운다).
  const [captureReport, setCaptureReport] = useState<CaptureAllReport | null>(null)
  // 항목 삭제(uninstall) 다이얼로그 상태 — 단건(행의 Delete)·일괄(체크리스트
  // "Continue") 둘 다 같은 DeleteConfirmDialog를 연다. `deleteRowKey`는 단건
  // 삭제일 때만 채워 그 행의 컨트롤을 시각적으로 "Delete" 선택 상태로 보여준다
  // (취소하면 null로 되돌아가 원래 Sync/Pause 값으로 복원 — 선택이 남지 않는다).
  const [deleteDialogItems, setDeleteDialogItems] = useState<readonly DeletableItem[] | null>(null)
  const [deleteRowKey, setDeleteRowKey] = useState<string | null>(null)
  const [bulkChecklistOpen, setBulkChecklistOpen] = useState(false)
  // 두 다이얼로그 모두 열 때마다 이 카운터를 올려 `key`로 넘긴다 — React가
  // 컴포넌트 전체를 리마운트해 이전 상태(preview/checked 등)를 effect 없이
  // 깨끗하게 리셋한다(react-hooks/set-state-in-effect 회피 — 각 다이얼로그
  // 컴포넌트 주석 참조).
  const [bulkDialogSeq, setBulkDialogSeq] = useState(0)
  const [deleteConfirmSeq, setDeleteConfirmSeq] = useState(0)
  // WS6 사후 정리: R8 시절엔 이 플래그가 ignore 토글·host 계층 스위치의
  // 비활성 여부까지 겸했지만, 배치 A(WS5)로 그 쓰기들이 follower에서도
  // authored write로 저장·push되면서 그 의미가 거짓이 됐다(copy.ts
  // `toggleDisabledReason` 주석 참조) — 그 용도는 전부 지웠다. 지금 남은
  // 용도는 배너 문구 변형(candidatesIntroCopy·registerInsteadText)과 벌크
  // Capture 버튼 노출뿐이다(둘 다 여전히 reference 전용 — 벌크 capture 자체는
  // 이번 라운드 role 비대칭 유지 대상). "토글 비활성" 의미의 헬퍼 이름을
  // 재사용하지 않기 위해 role을 직접 비교한다.
  const isFollower = status?.role === 'follower'

  async function refresh(): Promise<void> {
    await syncItemsSnapshotSlot.revalidate(fetchSyncItemsSnapshot)
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  // R6 R1: 화면 상단 집계는 검색 필터·그룹 구분과 무관하게 전체 항목을 센다.
  // R7: detectionOnly 그룹(snap)은 4상태 개념이 성립하지 않으므로 이 집계와
  // "보류 중인 변경" 배너 계산 둘 다에서 뺀다 — 그렇지 않으면 동기화 대상이
  // 아닌 항목이 배너 숫자를 부풀린다(코디네이터가 발견한 23건 중 14건 snap 버그).
  const overallCounts = useMemo<StateCounts>(
    () =>
      mergeStateCounts(
        (groups ?? []).filter((g) => !g.detectionOnly).map((g) => computeStateCounts(g.items))
      ),
    [groups]
  )
  const pendingCount = overallCounts.pendingAdd + overallCounts.pendingRemove

  // v0.1.20 2번: "보류 중인 변경 N건" 배너에 항목 이름까지 나열한다 — 위
  // overallCounts와 정확히 같은 필터(detectionOnly 그룹 제외)로 모은다.
  // pendingChangesCopy.bannerItemNames가 5개까지만 자르고 나머지는 "외 M건"으로
  // 접는다(apt 100개짜리 그룹이 배너를 뒤덮지 않게).
  const pendingItemNames = useMemo(
    () =>
      (groups ?? [])
        .filter((g) => !g.detectionOnly)
        .flatMap((g) =>
          g.items.filter((i) => i.state === 'pending-add' || i.state === 'pending-remove')
        )
        .map((i) => i.label),
    [groups]
  )

  // 일괄 삭제 툴바 버튼 노출·체크리스트 기본 목록 — 검색 필터와 무관하게
  // 항상 전체 groups를 대상으로 한다(그룹 헤더 집계와 같은 원칙 — R6 R1).
  const deletableItems = useMemo(() => collectDeletableItems(groups ?? []), [groups])

  // R4 스크린샷 하네스 전용 — main이 'items-delete-confirm'/'items-bulk-delete'를
  // 지시하면(App.tsx가 이 탭으로 전환한 뒤 다시 뿌리는 CustomEvent, 자세한
  // 이유는 App.tsx/DiffView.tsx의 같은 패턴 주석 참조) 해당 다이얼로그를
  // 강제로 연다. 평상시 앱 동작에는 전혀 관여하지 않는다.
  //
  // 이벤트 도착과 목록 로딩(refresh) 완료 순서가 보장되지 않는다 — 이
  // 화면은 탭이 바뀔 때마다 언마운트/재마운트되므로(App.tsx가 활성 탭만
  // 렌더) 매번 `listSyncItems()`를 새로 기다려야 하는데, 이벤트는 탭 전환
  // 300ms 뒤에 곧장 날아온다. 그래서 이벤트 자체는 "요청을 기억"만 하고
  // (pendingScreenshotRoute), 실제 다이얼로그를 여는 건 `deletableItems`가
  // 채워진 뒤(별도 effect)로 미룬다.
  const [pendingScreenshotRoute, setPendingScreenshotRoute] = useState<
    'items-delete-confirm' | 'items-bulk-delete' | null
  >(null)
  // refactor-spec-v0.2 §1 검증용 — "배포판 기본" 그룹으로 스크롤(+선택 펼침).
  // 삭제 다이얼로그 루트와 같은 "요청 기억 후 데이터 로딩 뒤 실행" 패턴.
  const [pendingDistroRoute, setPendingDistroRoute] = useState<
    'items-distro' | 'items-distro-open' | null
  >(null)

  useEffect(() => {
    const listener = (event: Event): void => {
      const route = (event as CustomEvent<ScreenshotRoute>).detail
      if (route === 'items-bulk-delete' || route === 'items-delete-confirm') {
        setPendingScreenshotRoute(route)
      }
      if (route === 'items-distro' || route === 'items-distro-open') {
        setPendingDistroRoute(route)
      }
      // WS6("창고 모델 1차") 검증용 — 이 다이얼로그는 groups 로딩과 무관하게
      // 열 수 있어(빈 폼으로 시작) pending 2단계 패턴이 필요 없다.
      if (route === 'items-register-dotfile') {
        setRegisterDotfileSeq((n) => n + 1)
        setRegisterDotfileOpen(true)
      }
    }
    window.addEventListener(SCREENSHOT_GOTO_EVENT, listener)
    return () => window.removeEventListener(SCREENSHOT_GOTO_EVENT, listener)
  }, [])

  useEffect(() => {
    if (!pendingScreenshotRoute) return
    if (deletableItems.length === 0) return // groups 로딩 대기 — 다음 렌더에서 다시 시도
    if (pendingScreenshotRoute === 'items-bulk-delete') {
      // 직전 단계(items-delete-confirm)의 다이얼로그가 열려 있으면 먼저
      // 닫는다 — 스크린샷에 두 다이얼로그가 겹쳐 보이지 않게.
      closeDeleteDialog()
      openBulkChecklist()
    } else {
      setBulkChecklistOpen(false)
      // curl처럼 apt 의존성 경고가 있는 항목을 우선 데모로 고른다 — 없으면
      // 첫 삭제 가능 항목.
      const target = deletableItems.find((i) => i.key === 'curl') ?? deletableItems[0]
      setDeleteConfirmSeq((n) => n + 1)
      setDeleteRowKey(`${target.capability}:${target.key}`)
      setDeleteDialogItems([target])
    }
    setPendingScreenshotRoute(null)
  }, [pendingScreenshotRoute, deletableItems])

  const rows = useMemo<Row[]>(() => {
    if (!groups) return []
    const q = query.trim().toLowerCase()
    const out: Row[] = []
    // WS6: "Add file/folder" 버튼은 dotfiles capability의 첫 헤더 행에만 —
    // main/추천(dotfiles-suggested) 두 그룹으로 갈렸어도 정확히 한 곳에만 뜬다.
    let addDotfileButtonPlaced = false
    for (const group of groups) {
      const items = q ? group.items.filter((i) => i.label.toLowerCase().includes(q)) : group.items
      if (items.length === 0) continue
      const detectionOnly = !!group.detectionOnly
      const groupId = groupIdOf(group)
      // 검색 중엔 접힘을 무시한다 — 접힌 그룹 안의 매치를 소리 없이 숨기지
      // 않는다(스펙 판단 원칙 2). 평상시엔 오버라이드 > collapsedByDefault.
      const collapsed = q ? false : (collapsedOverrides[groupId] ?? !!group.collapsedByDefault)
      const showAddDotfileButton = group.capability === 'dotfiles' && !addDotfileButtonPlaced
      if (showAddDotfileButton) addDotfileButtonPlaced = true
      out.push({
        kind: 'header',
        key: `h:${groupId}`,
        title: `${group.title} (${items.length})`,
        capability: group.capability,
        groupId,
        subgroup: group.subgroup,
        detectionOnly,
        collapsed,
        // 그룹 토글·집계는 검색 필터와 무관하게 항상 그룹 전체를 대상으로 한다.
        groupState: computeGroupState(group.items, group.subgroup),
        allItemKeys: group.items.map((i) => i.key),
        // R7: detectionOnly면 stateCounts는 무의미하니 안 채우고(0으로 둠)
        // detectedCount만 채운다 — 렌더가 detectionOnly 분기에서 골라 쓴다.
        stateCounts: detectionOnly ? EMPTY_STATE_COUNTS : computeStateCounts(group.items),
        detectedCount: detectionOnly ? group.items.length : 0,
        // WS3: detectionOnly 그룹(snap)엔 구독 개념이 없다 — appimage/candidates.ts류와
        // 같은 원칙으로 그냥 비워둔다.
        subscribeGroupState: detectionOnly ? null : computeSubscribeGroupState(group.items),
        subscribeKeys: detectionOnly ? [] : subscribeEligibleKeys(group.items),
        showAddDotfileButton
      })
      if (collapsed) continue
      for (const item of items) {
        const eligibility = computeDeleteEligibility({
          capability: group.capability,
          managed: item.managed,
          ignored: item.ignored,
          detectionOnly
        })
        out.push({
          kind: 'item',
          key: `${group.capability}:${item.key}`,
          capability: group.capability,
          subgroup: group.subgroup,
          itemKey: item.key,
          label: item.label,
          description: item.description,
          managed: item.managed,
          ignored: item.ignored,
          included: !!item.included,
          state: item.state,
          detectionOnly,
          deleteEligible: eligibility.eligible,
          hostOnly: !!item.hostOnly,
          ...(eligibility.reason ? { deleteDisabledReason: eligibility.reason } : {}),
          ...(item.unresolvableReason ? { unresolvableReason: item.unresolvableReason } : {})
        })
      }
    }
    return out
  }, [groups, query, collapsedOverrides])

  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? 28 : 32),
    overscan: 16
  })

  // 스크린샷 하네스 전용 — rows가 채워진 뒤 "배포판 기본" 그룹 헤더로 스크롤
  // 한다('open'이면 먼저 펼침 오버라이드를 넣고, 펼쳐진 rows로 다시 이 effect가
  // 돌 때 스크롤). 평상시 앱 동작에는 전혀 관여하지 않는다.
  useEffect(() => {
    if (!pendingDistroRoute) return
    // 직전 스크린샷 단계가 열어둔 다이얼로그를 먼저 닫는다 — 안 닫으면
    // 스크린샷에 다이얼로그가 겹쳐 목록이 안 보인다(items-bulk-delete 단계와
    // 같은 회피, 그 effect의 closeDeleteDialog() 주석 참조).
    setBulkChecklistOpen(false)
    closeDeleteDialog()
    const idx = rows.findIndex((r) => r.kind === 'header' && r.subgroup === 'apt-distro')
    if (idx < 0) return // groups 로딩 대기 — 다음 렌더에서 다시 시도
    const header = rows[idx]
    if (
      pendingDistroRoute === 'items-distro-open' &&
      header.kind === 'header' &&
      header.collapsed
    ) {
      setCollapsedOverrides((prev) => ({ ...prev, [header.groupId]: false }))
      return // 펼쳐진 rows로 재계산된 뒤 스크롤
    }
    // 리스트 컨테이너가 스크롤 주체가 아닐 수도 있다(스크린샷 창처럼 창이
    // 콘텐츠보다 크면 페이지가 스크롤 주체) — virtualizer 스크롤에 더해 실제
    // 헤더 DOM 요소를 scrollIntoView로 데려온다(어느 조상이 스크롤하든 동작).
    // fresh mount 직후엔 가상 스크롤러가 그 행의 DOM을 아직 안 그렸을 수
    // 있어(ResizeObserver 측정 전) 짧게 폴링한다.
    virtualizer.scrollToIndex(idx, { align: 'start' })
    // 캡처 시점까지 주기적으로 재적용한다 — fresh mount 직후엔 늦은 레이아웃
    // 변동이 스크롤을 되돌릴 수 있어 한 번의 scrollIntoView로는 안정적이지
    // 않았다(실측). effect cleanup으로 타이머를 취소하면 안 된다 — 바로 아래
    // setPendingDistroRoute(null)이 같은 틱에 cleanup을 돌려 재시도가 전부
    // 죽는다(실측). 하네스 전용 경로 + 상한 있는 타이머라 누수 걱정은 없다.
    const attempt = (tries: number): void => {
      document.querySelector('[data-row-key="h:apt-distro"]')?.scrollIntoView({ block: 'start' })
      if (tries > 0) setTimeout(() => attempt(tries - 1), 500)
    }
    attempt(14)
    setPendingDistroRoute(null)
  }, [pendingDistroRoute, rows, virtualizer])

  async function toggle(
    capability: SyncItemGroupDto['capability'],
    key: string,
    ignored: boolean,
    subgroup?: SyncItemGroupDto['subgroup']
  ): Promise<void> {
    const rowKey = `${capability}:${key}`
    setPendingKeys((prev) => ({ ...prev, [rowKey]: true }))
    try {
      // refactor-spec-v0.2 §1: apt-distro면 main이 ignore 대신 include 예외
      // 경로로 라우팅한다(요청의 subgroup 필드 — shared/ipc.ts 참조).
      const next = await window.api.engine.toggleIgnore({ capability, key, ignored, subgroup })
      syncItemsSnapshotSlot.set(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingKeys((prev) => ({ ...prev, [rowKey]: false }))
    }
  }

  // F2: "이 머신 전용" 스위치 — ignore와 달리 manifest를 그 자리에서 즉시
  // 바꾼다(다음 Capture를 기다리지 않는다, engine/hostLayerMove.ts 참조).
  async function toggleHostLayer(
    capability: HostLayerCapability,
    key: string,
    nextHostOnly: boolean
  ): Promise<void> {
    const rowKey = `${capability}:${key}`
    setPendingHostKeys((prev) => ({ ...prev, [rowKey]: true }))
    try {
      const next = nextHostOnly
        ? await window.api.engine.moveEntryToHostLayer({ capability, key })
        : await window.api.engine.moveEntryToCommonLayer({ capability, key })
      syncItemsSnapshotSlot.set(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingHostKeys((prev) => ({ ...prev, [rowKey]: false }))
    }
  }

  // WS3: 머신별 구독 Switch — mode 무관(select/all 둘 다 setSubscribed가 처리,
  // selection.ts 참조) managed && !ignored 행에서 동작한다. host 계층 이동과
  // 달리 follower도 비활성화하지 않는다(selection.toml은 머신별 파일이라
  // 다른 머신과 충돌하지 않고, 배치 A로 follower도 git 저작 경로를 갖췄다).
  async function toggleSubscribeItem(
    capability: SyncItemGroupDto['capability'],
    key: string,
    subscribed: boolean
  ): Promise<void> {
    const rowKey = `${capability}:${key}`
    setPendingSubscribeKeys((prev) => ({ ...prev, [rowKey]: true }))
    try {
      const next = await window.api.engine.toggleSubscribe({ capability, key, subscribed })
      syncItemsSnapshotSlot.set(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingSubscribeKeys((prev) => ({ ...prev, [rowKey]: false }))
    }
  }

  // WS3: 그룹 단위 "모두 구독/해제" — 1커밋으로 묶기 위해 toggleSubscribeBulk를 쓴다.
  async function toggleSubscribeGroupAll(
    groupId: string,
    capability: SyncItemGroupDto['capability'],
    state: SubscribeGroupState,
    keys: readonly string[]
  ): Promise<void> {
    setPendingSubscribeGroups((prev) => ({ ...prev, [groupId]: true }))
    try {
      const next = await window.api.engine.toggleSubscribeBulk({
        capability,
        keys,
        subscribed: nextBulkSubscribedValue(state)
      })
      syncItemsSnapshotSlot.set(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingSubscribeGroups((prev) => ({ ...prev, [groupId]: false }))
    }
  }

  // WS4: pending-add/unresolvable 행의 "Register" 단건 액션 — 성공하면 그
  // 행이 synced(또는 not-subscribed)로 즉시 갱신된다. git push까지 await하는
  // IPC라(engine:registerEntry) 응답에 동봉된 sync가 error면 "등록은 됐지만
  // 동기화 실패"를 그 자리에서 알린다(이 repo의 반복된 교훈 — "됐는지 안
  // 됐는지 알 수 없음" 재발 방지).
  async function registerItem(
    capability: SyncItemGroupDto['capability'],
    key: string
  ): Promise<void> {
    const rowKey = `${capability}:${key}`
    setPendingRegisterKeys((prev) => ({ ...prev, [rowKey]: true }))
    setError(null)
    try {
      const response = await window.api.engine.registerEntry({
        capability: capability as RegisterCapability,
        key
      })
      syncItemsSnapshotSlot.set(response.groups)
      if (response.sync.kind === 'error') {
        setError(`${registerActionCopy.pushFailedPrefix}${response.sync.message}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingRegisterKeys((prev) => ({ ...prev, [rowKey]: false }))
    }
  }

  // WS4: "Remove from catalog" — 확인 다이얼로그를 연다(즉시 실행 아님, 삭제와
  // 동일하게 확인 게이트를 거친다).
  function openUnregisterDialog(row: Extract<Row, { kind: 'item' }>): void {
    setUnregisterSeq((n) => n + 1)
    setUnregisterItem({
      capability: row.capability as RegisterCapability,
      key: row.itemKey,
      label: row.label
    })
  }

  function closeUnregisterDialog(): void {
    setUnregisterItem(null)
  }

  function handleUnregisterCompleted(): void {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  async function toggleGroup(
    groupId: string,
    capability: SyncItemGroupDto['capability'],
    state: GroupToggleState,
    allItemKeys: readonly string[],
    subgroup?: SyncItemGroupDto['subgroup']
  ): Promise<void> {
    // 클릭 시 항상 "전부 동기화 대상"을 향해 움직인다: 이미 전부 동기화
    // 대상이면 전부 ignore로, 그 외(전부 ignore 또는 혼합)면 전부 동기화
    // 대상으로 — 표준 "전체 선택" 체크박스 관례.
    const nextIgnored = state === 'all-synced'
    setPendingGroups((prev) => ({ ...prev, [groupId]: true }))
    try {
      const next = await window.api.engine.toggleIgnoreBulk({
        capability,
        keys: allItemKeys,
        ignored: nextIgnored,
        subgroup
      })
      syncItemsSnapshotSlot.set(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingGroups((prev) => ({ ...prev, [groupId]: false }))
    }
  }

  // R6 R1: 보류 중(pending-add/pending-remove)이 있을 때 Capture로 안내한다
  // (State 층 — "다음 행동 안내"). 실제 capture-all 호출은 DiffView와 공유하는
  // captureAll() 헬퍼 하나로 처리한다.
  // v0.1.20 1번: captureAll()의 구조화된 리포트를 CaptureReportSummary로 보여준다.
  // v0.1.20 3번: 이 화면 자신의 refresh()에 더해 Differences 스토어도 강제
  // 재검증한다(revalidateAfterCapture) — DiffView의 handleCapture와 대칭.
  async function handleCapture(): Promise<void> {
    setCaptureBusy(true)
    setError(null)
    setCaptureReport(null)
    try {
      const report = await captureAll()
      setCaptureReport(report)
      await refresh()
      await revalidateAfterCapture(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCaptureBusy(false)
    }
  }

  // 단건 삭제(행의 Delete) — 확인 다이얼로그를 열고 그 행만 시각적으로
  // "Delete" 선택 상태로 보여준다. 아직 아무것도 바꾸지 않는다(1회성 행동은
  // 실제 실행 확인 후에만 일어난다).
  function openRowDelete(row: Extract<Row, { kind: 'item' }>): void {
    setDeleteConfirmSeq((n) => n + 1)
    setDeleteRowKey(row.key)
    setDeleteDialogItems([
      {
        capability: row.capability,
        key: row.itemKey,
        label: row.label,
        ...(row.description ? { description: row.description } : {})
      }
    ])
  }

  // 다이얼로그가 닫힐 때(취소든 완료 후 Close든) 항상 이 하나로 되돌린다 —
  // 취소면 아무 것도 안 바뀌었으니 행이 원래 Sync/Pause 값으로 복원되고,
  // 완료면 목록 자체가 새로고침돼(handleDeleteCompleted) 그 항목이 사라진다.
  function closeDeleteDialog(): void {
    setDeleteDialogItems(null)
    setDeleteRowKey(null)
  }

  function handleDeleteCompleted(): void {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  // 일괄 삭제 2단계 — 체크리스트에서 "Continue"를 누르면 선택된 항목만 들고
  // 같은 확인 다이얼로그를 연다. `deleteRowKey`는 일괄 삭제엔 해당 행이 없으니
  // null로 둔다.
  function handleBulkContinue(selected: readonly DeletableItem[]): void {
    setBulkChecklistOpen(false)
    setDeleteRowKey(null)
    setDeleteConfirmSeq((n) => n + 1)
    setDeleteDialogItems(selected)
  }

  function openBulkChecklist(): void {
    setBulkDialogSeq((n) => n + 1)
    setBulkChecklistOpen(true)
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* R4-2 #2: "?" 헬프는 App.tsx 탭 바 우측 끝으로 통일했다(중복 제거). */}
      <ViewToolbar className="mb-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 rounded border border-border bg-transparent px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
          </TooltipTrigger>
          <TooltipContent>이름으로 항목 필터링(그룹 전체 토글에는 영향 없음)</TooltipContent>
        </Tooltip>
        {/* 사용자 명세: 버튼은 삭제 가능한 항목("일시중지 + 설치됨")이 하나
            이상일 때만 등장한다 — 평소엔 안 보여 실수 클릭을 막는다. 위치는
            검색창 옆(주 액션 Capture와는 다른 줄인 아래 배너 자리가 아니라
            이 화면의 유일한 툴바)이지만 destructive variant(danger 색)로
            나머지 컨트롤과 시각적으로 분리한다(Design constraints: 색+형태
            이중 인코딩 — 파괴적 행동은 눈에 띄게, 그러나 주 액션 자리를
            차지하지 않게 툴바 오른쪽 끝에 둔다). */}
        {deletableItems.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={openBulkChecklist}
                className="ml-auto shrink-0 rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-white hover:bg-destructive/90"
              >
                {bulkDeleteCopy.toolbarButton.label} ({deletableItems.length})
              </button>
            </TooltipTrigger>
            <TooltipContent>{bulkDeleteCopy.toolbarButton.subtitle}</TooltipContent>
          </Tooltip>
        )}
      </ViewToolbar>

      {/* R8: 화면 자체가 "이게 무엇인지"를 먼저 말한다(Microcopy 층) — 실사용
          실패("추가 예정 99"가 무슨 뜻인지 화면만 보고 전혀 짐작 못 함) 재발
          방지. role별로 "안 들어있는 항목"이 실제로 어떻게 되는지만 갈라
          말한다(copy.ts candidatesIntroCopy). */}
      <p className="-mt-1 text-[11px] text-muted-foreground">
        {isFollower ? candidatesIntroCopy.follower : candidatesIntroCopy.reference}
      </p>

      {/* WS7("창고 모델 1차"): 온보딩에서 "선택 구독"을 고르고 막 완료했을
          때만 뜨는 일회성 안내 — 그룹 체크박스·구독 Switch가 곧 피커라는
          사실을 한 줄로 알려준다(App.tsx가 처음 탭 진입 시에만 true로 준다). */}
      {showSelectionOnboardingHint && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <p className="text-[11px] text-foreground">{selectionModeCopy.syncItemsLandingHint}</p>
          <button
            onClick={onDismissSelectionOnboardingHint}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
            aria-label="안내 닫기"
          >
            Dismiss
          </button>
        </div>
      )}

      {groups !== null && groups.length > 0 && (
        <p className="-mt-1 text-[11px] text-muted-foreground">
          전체: {formatSyncItemStateSummary(overallCounts, status?.role) || '해당 없음'}
        </p>
      )}

      {/* R6 R1: 보류 중 변경이 있을 때만 배너를 띄운다(0건이면 안 보임).
          WS3("창고 모델" 전 머신 저작): R8 시절엔 follower에서 아예 숨겼지만
          (capture 불가에 "Capture를 실행하세요"는 불가능한 행동 지시), 배치
          A(WS5)로 follower도 git 저작 경로를 갖춰 각 행의 Register 버튼으로
          개별 등록할 수 있게 됐다 — role과 무관하게 배너를 띄우되, 벌크
          Capture 버튼은 reference 전용으로 남기고 비reference는 개별 등록
          안내로 대체한다(shouldShowPendingCaptureBanner 주석 참조). */}
      {shouldShowPendingCaptureBanner(pendingCount) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warn/40 bg-status-warn/10 px-3 py-2">
          <div className="min-w-0 flex-1">
            <StatusText kind="warn">
              {isFollower
                ? pendingChangesCopy.registerInsteadText(pendingCount)
                : pendingChangesCopy.bannerText(pendingCount)}
            </StatusText>
            {/* v0.1.20 2번: 항목 이름까지 — "N건"만으로는 뭐가 바뀌는지 안 보였다. */}
            <p
              className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground"
              title={pendingItemNames.join(', ')}
            >
              {pendingChangesCopy.bannerItemNames(pendingItemNames)}
            </p>
          </div>
          {!isFollower && (
            <ActionButton
              variant="secondary"
              size="sm"
              label={buttonCopy.capture.label}
              subtitle={pendingChangesCopy.captureSubtitle}
              busy={captureBusy}
              disabled={captureBusy}
              onClick={handleCapture}
            />
          )}
        </div>
      )}

      {/* v0.1.20 1번: 마지막 Capture 결과 — DiffView와 같은 컴포넌트·같은 위치 규칙
          (에러 바로 위, 목록 바로 아래). */}
      {captureReport && (
        <CaptureReportSummary report={captureReport} onDismiss={() => setCaptureReport(null)} />
      )}

      {(error ?? syncItemsSnapshot.error) && (
        <StatusText kind="error">{error ?? syncItemsSnapshot.error}</StatusText>
      )}

      {groups === null ? (
        // UI 정돈(v0.1.16): 로딩 완료 후 나타날 가상 스크롤 목록과 같은
        // 보더 컨테이너 모양을 미리 보여줘 레이아웃 점프를 없앤다 — 행
        // 몇 개 분량의 스켈레톤 바로 "곧 목록이 온다"를 암시한다.
        <div className="flex-1 space-y-2 overflow-hidden rounded border border-border p-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className={i % 2 === 0 ? 'h-4 w-full' : 'h-4 w-2/3'} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {query ? emptyStateCopy.noSearchResults : emptyStateCopy.noCandidates}
        </p>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto rounded border border-border">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]
              return (
                <div
                  key={row.key}
                  data-row-key={row.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                  className={
                    row.kind === 'header'
                      ? 'flex items-center gap-2 bg-secondary px-2 text-xs font-semibold text-secondary-foreground'
                      : 'flex items-center justify-between gap-2 border-t border-border px-2 text-xs'
                  }
                >
                  {row.kind === 'header' ? (
                    <>
                      <GroupCheckbox
                        state={row.groupState}
                        subgroup={row.subgroup}
                        disabled={
                          row.detectionOnly ||
                          !!pendingGroups[row.groupId] ||
                          isIgnoreUnsupportedCapability(row.capability)
                        }
                        disabledReason={toggleDisabledReason(
                          row.detectionOnly,
                          isIgnoreUnsupportedCapability(row.capability)
                        )}
                        onClick={() =>
                          toggleGroup(
                            row.groupId,
                            row.capability,
                            row.groupState,
                            row.allItemKeys,
                            row.subgroup
                          )
                        }
                      />
                      {/* WS3("창고 모델" 구독): 그룹 단위 "모두 구독/해제" —
                          구독 개념이 성립하는 항목이 하나도 없으면(예: 전부
                          미관리) subscribeGroupState가 null이라 버튼 자체가
                          안 뜬다. ignore 토글(위 GroupCheckbox)과 독립된
                          컨트롤이라 별도 busy 상태(pendingSubscribeGroups)를 쓴다. */}
                      {row.subscribeGroupState !== null && (
                        <ActionButton
                          variant="ghost"
                          size="xs"
                          label={
                            bulkSubscribeCopy[toBulkSubscribeCopyKey(row.subscribeGroupState)].label
                          }
                          subtitle={
                            bulkSubscribeCopy[toBulkSubscribeCopyKey(row.subscribeGroupState)]
                              .subtitle
                          }
                          busy={!!pendingSubscribeGroups[row.groupId]}
                          disabled={!!pendingSubscribeGroups[row.groupId]}
                          onClick={() =>
                            toggleSubscribeGroupAll(
                              row.groupId,
                              row.capability,
                              row.subscribeGroupState as SubscribeGroupState,
                              row.subscribeKeys
                            )
                          }
                        />
                      )}
                      {/* WS6("창고 모델 1차"): dotfiles 그룹의 "Add file/folder"
                          진입 버튼 — SEED 후보뿐 아니라 카탈로그에 아직 없는
                          임의 경로를 새로 등록하는 다이얼로그를 연다(정확히
                          한 헤더에만 뜬다, showAddDotfileButton 계산 참조). */}
                      {row.showAddDotfileButton && (
                        <ActionButton
                          variant="secondary"
                          size="xs"
                          label={addDotfileButtonCopy.label}
                          subtitle={addDotfileButtonCopy.subtitle}
                          onClick={() => {
                            setRegisterDotfileSeq((n) => n + 1)
                            setRegisterDotfileOpen(true)
                          }}
                        />
                      )}
                      {/* refactor-spec-v0.2 §1: 접을 수 있는 그룹(배포판 기본)은
                          헤더 전체가 아니라 명시적 chevron 버튼으로 펼친다 —
                          접혀 있어도 헤더·집계는 항상 보인다(절대 숨기지 않는다). */}
                      <button
                        onClick={() =>
                          setCollapsedOverrides((prev) => ({
                            ...prev,
                            [row.groupId]: !row.collapsed
                          }))
                        }
                        className="flex items-center gap-1 hover:text-foreground"
                        title={row.collapsed ? '그룹 펼치기' : '그룹 접기'}
                        aria-label={row.collapsed ? '그룹 펼치기' : '그룹 접기'}
                      >
                        {row.collapsed ? (
                          <ChevronRight className="size-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="size-3.5" aria-hidden="true" />
                        )}
                        <span className="font-mono">{row.title}</span>
                      </button>
                      {row.detectionOnly && (
                        <span className="text-status-muted">— detection-only</span>
                      )}
                      {/* R6 R1: 그룹 헤더 집계 — 검색 필터와 무관하게 그룹 전체 값,
                          0건인 상태는 생략해 158행짜리 그룹에서도 잡음을 줄인다.
                          R7: detectionOnly는 4상태 요약이 아니라 "검출됨 N"만 말한다
                          (동기화 대상이 아닌 그룹이 "추가 예정"을 말하는 자기모순 수정).
                          R8: pending-add 라벨은 role에 따라 달라지므로 role도 넘긴다. */}
                      <span className="ml-auto shrink-0 truncate font-mono text-[10px] font-normal text-muted-foreground">
                        {row.detectionOnly
                          ? formatDetectionOnlySummary(row.detectedCount)
                          : formatSyncItemStateSummary(row.stateCounts, status?.role)}
                      </span>
                    </>
                  ) : (
                    <>
                      {/* R6 R1: managed/unmanaged 아이콘 하나였던 것을 상태
                          아이콘+라벨로 넓힌다 — "내가 고른 스위치가 실제로 manifest에
                          반영됐는지"를 상태 이름으로 직접 말해준다(색+형태 병행:
                          pending-add/remove는 같은 warn 색이지만 +/− 모양으로 구분).
                          R8: 라벨·설명은 role-aware(describeSyncItemState) — follower의
                          pending-add는 "추가 예정"이 아니라 "manifest에 없음"으로 보인다. */}
                      <span
                        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
                        title={`${describeSyncItemState(row.state, status?.role).label} — ${describeSyncItemState(row.state, status?.role).description}`}
                      >
                        <CandidateStateIcon state={row.state} />
                        <span className="shrink-0 font-mono text-foreground">{row.label}</span>
                        {/* F2: host 계층 소속 배지 — follower 화면에서는 다른
                            머신의 host 전용 항목이 애초에 effective manifest에
                            없어 이 배지 자체가 안 뜬다(자연히 안 보임, 스펙
                            판단 원칙 3 "화면은 머신이 아는 것만 말한다"). */}
                        {row.hostOnly && (
                          <span
                            className="shrink-0 rounded border border-border px-1 text-[10px] font-normal text-muted-foreground"
                            title={hostLayerToggleCopy.badgeTooltip}
                          >
                            {hostLayerToggleCopy.badge}
                          </span>
                        )}
                        {row.description && (
                          <span className="truncate text-muted-foreground" title={row.description}>
                            — {row.description}
                          </span>
                        )}
                        {/* v0.1.20 4번: capture가 담을 수 없는 구체적 사유를 행에서 바로
                            보여준다(해소 방법은 위 title 툴팁 — describeSyncItemState의
                            unresolvable description에 있다). */}
                        {row.state === 'unresolvable' && row.unresolvableReason && (
                          <span
                            className="truncate text-status-warn"
                            title={row.unresolvableReason}
                          >
                            — {row.unresolvableReason}
                          </span>
                        )}
                      </span>
                      {/* F2: "이 머신 전용" 전환 — dotfiles·services 항목에만
                          뜬다(HOST_LAYER_CAPABILITIES). ignore 토글(위
                          CandidateStateControl)과는 독립된 컨트롤이라 별도
                          busy 상태(pendingHostKeys)를 쓴다. */}
                      {isHostLayerCapability(row.capability) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex shrink-0 items-center gap-1.5">
                              <Switch
                                size="sm"
                                checked={row.hostOnly}
                                disabled={pendingHostKeys[row.key]}
                                onCheckedChange={(checked) =>
                                  toggleHostLayer(
                                    row.capability as HostLayerCapability,
                                    row.itemKey,
                                    checked
                                  )
                                }
                                aria-label={`${row.label} — ${hostLayerToggleCopy.label}`}
                              />
                              <span className="text-muted-foreground">
                                {hostLayerToggleCopy.label}
                              </span>
                            </label>
                          </TooltipTrigger>
                          <TooltipContent>
                            {row.hostOnly
                              ? hostLayerToggleCopy.onTooltip
                              : hostLayerToggleCopy.offTooltip}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {/* WS3("창고 모델" 구독): 이 머신이 이 항목을 구독하는지
                          — mode 무관 managed && !ignored 행에서만 뜬다(그 조건은
                          state가 'synced'/'not-subscribed' 둘 중 하나일 때와
                          정확히 같다, registryUiHelpers `isSubscribeEligible`
                          참조). host 계층 스위치·ignore 토글과 마찬가지로
                          follower도 비활성화하지 않는다(selection.toml은
                          머신별 파일이라 다른 머신과 충돌하지 않고, 배치 A로
                          follower도 git 저작 경로를 갖췄다). */}
                      {isSubscribeEligible(row) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <label className="flex shrink-0 items-center gap-1.5">
                              <Switch
                                size="sm"
                                checked={row.state !== 'not-subscribed'}
                                disabled={pendingSubscribeKeys[row.key]}
                                onCheckedChange={(checked) =>
                                  toggleSubscribeItem(row.capability, row.itemKey, checked)
                                }
                                aria-label={`${row.label} — ${subscribeToggleCopy.label}`}
                              />
                              <span className="text-muted-foreground">
                                {subscribeToggleCopy.label}
                              </span>
                            </label>
                          </TooltipTrigger>
                          <TooltipContent>
                            {row.state !== 'not-subscribed'
                              ? subscribeToggleCopy.onTooltip
                              : subscribeToggleCopy.offTooltip}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {/* WS4("창고 모델" 등록): pending-add/unresolvable 행의
                          단건 등록 — dotfiles(재캡처만 지원)·비발견형
                          capability는 showsRegisterButton이 걸러 버튼 자체가
                          안 뜬다. unresolvable이면 사유를 그대로 비활성 툴팁에
                          싣는다(capture와 같은 "추가 불가" 판정을 재사용). */}
                      {showsRegisterButton(row.capability, row.state) && (
                        <ActionButton
                          variant="secondary"
                          size="xs"
                          label={registerActionCopy.label}
                          subtitle={registerActionCopy.subtitle}
                          busy={pendingRegisterKeys[row.key]}
                          disabled={
                            pendingRegisterKeys[row.key] ||
                            (row.state === 'unresolvable' && !!row.unresolvableReason)
                          }
                          disabledReason={row.unresolvableReason}
                          onClick={() => registerItem(row.capability, row.itemKey)}
                        />
                      )}
                      {/* WS4: "Remove from catalog" — 기존 Delete(로컬 시스템
                          삭제)와 완전히 다른 연산이라 별도 아이콘·라벨로
                          시각적으로 분리한다(unregisterActionCopy 주석 참조).
                          managed 항목에만 뜨고, registry.ts가 지원하지 않는
                          capability(services·binaries·snap 등)에는 안 뜬다. */}
                      {showsUnregisterButton(row.capability, row.managed) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => openUnregisterDialog(row)}
                              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                              aria-label={`${row.label} — ${unregisterActionCopy.label}`}
                            >
                              <PackageMinus className="size-3.5" aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{unregisterActionCopy.subtitle}</TooltipContent>
                        </Tooltip>
                      )}
                      <CandidateStateControl
                        // 사용자 명세: 3상태(Sync/Pause/Delete)가 각각 직접
                        // 선택 가능한 세그먼트 컨트롤. Sync/Pause는 기존
                        // Switch와 같은 비활성 규칙(detectionOnly·
                        // ignoreUnsupported — toggleDisabledReason)을 그대로
                        // 따르고, Delete는 별도 판정(computeDeleteEligibility,
                        // 행 생성 시 계산됨)을 쓴다. WS6 사후 정리: 예전엔
                        // Sync/Pause만 follower에서 비활성이라 Delete와의
                        // 비대칭을 별도 안내했지만, 배치 A(WS5)로 그 비대칭
                        // 자체가 없어졌다(Sync/Pause·Delete 모두 role 무관 —
                        // copy.ts `toggleDisabledReason` 주석 참조).
                        // refactor-spec-v0.2 §1: apt-distro 그룹의 미관리 항목은
                        // ignored가 아니라 include가 켬/끔을 결정한다(isItemOn).
                        value={
                          deleteRowKey === row.key
                            ? 'delete'
                            : controlValueForItem(!isItemOn(row, row.subgroup))
                        }
                        ariaLabel={row.label}
                        syncPauseDisabled={
                          row.detectionOnly ||
                          pendingKeys[row.key] ||
                          isIgnoreUnsupportedCapability(row.capability)
                        }
                        syncPauseDisabledReason={toggleDisabledReason(
                          row.detectionOnly,
                          isIgnoreUnsupportedCapability(row.capability)
                        )}
                        deleteEligible={row.deleteEligible}
                        deleteDisabledReason={row.deleteDisabledReason}
                        onSyncPauseChange={(next) =>
                          toggle(row.capability, row.itemKey, next === 'pause', row.subgroup)
                        }
                        onDeleteRequest={() => openRowDelete(row)}
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <BulkDeleteChecklistDialog
        key={bulkDialogSeq}
        items={deletableItems}
        open={bulkChecklistOpen}
        onOpenChange={setBulkChecklistOpen}
        onContinue={handleBulkContinue}
      />

      <DeleteConfirmDialog
        key={deleteConfirmSeq}
        items={deleteDialogItems ?? []}
        open={deleteDialogItems !== null}
        onOpenChange={(next) => !next && closeDeleteDialog()}
        onCompleted={handleDeleteCompleted}
      />

      <UnregisterConfirmDialog
        key={unregisterSeq}
        item={unregisterItem}
        open={unregisterItem !== null}
        onOpenChange={(next) => !next && closeUnregisterDialog()}
        onCompleted={handleUnregisterCompleted}
      />

      <RegisterDotfileDialog
        key={registerDotfileSeq}
        open={registerDotfileOpen}
        onOpenChange={setRegisterDotfileOpen}
        onRegistered={(next) => syncItemsSnapshotSlot.set(next)}
      />
    </div>
  )
}

export default SyncItemsView
