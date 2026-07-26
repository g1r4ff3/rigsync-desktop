import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { BulkDeleteChecklistDialog } from '@/components/BulkDeleteChecklistDialog'
import { CandidateStateControl } from '@/components/CandidateStateControl'
import { CandidateStateIcon } from '@/components/CandidateStateIcon'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { ViewToolbar } from '@/components/ViewToolbar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { captureAll } from '../captureAll'
import {
  bulkDeleteCopy,
  buttonCopy,
  candidatesIntroCopy,
  describeSyncItemState,
  emptyStateCopy,
  followerDeleteAsymmetryCopy,
  formatDetectionOnlySummary,
  formatSyncItemStateSummary,
  isFollowerToggleDisabled,
  pendingChangesCopy,
  shouldShowPendingCaptureBanner,
  toggleDisabledReason
} from '../copy'
import {
  collectDeletableItems,
  computeDeleteEligibility,
  controlValueForItem,
  type DeletableItem
} from '../deleteEligibility'
import { SCREENSHOT_GOTO_EVENT } from '../screenshotBus'
import { StatusText } from '../status'
import type {
  EngineStatus,
  ScreenshotRoute,
  SyncItemGroupDto,
  SyncItemState
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
}

type Row =
  | {
      readonly kind: 'header'
      readonly key: string
      readonly title: string
      readonly capability: SyncItemGroupDto['capability']
      readonly detectionOnly: boolean
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
    }
  | {
      readonly kind: 'item'
      readonly key: string
      readonly capability: SyncItemGroupDto['capability']
      readonly itemKey: string
      readonly label: string
      readonly description?: string
      readonly managed: boolean
      readonly ignored: boolean
      readonly state: SyncItemState
      /** R7: 소속 그룹이 detectionOnly면 스위치를 비활성화한다. */
      readonly detectionOnly: boolean
      /** computeDeleteEligibility 결과를 행 생성 시점에 미리 계산해 둔다. */
      readonly deleteEligible: boolean
      readonly deleteDisabledReason?: string
    }

function computeGroupState(items: SyncItemGroupDto['items']): GroupToggleState {
  if (items.length === 0) return 'all-synced'
  const ignoredCount = items.filter((i) => i.ignored).length
  if (ignoredCount === 0) return 'all-synced'
  if (ignoredCount === items.length) return 'all-ignored'
  return 'mixed'
}

/**
 * R7: 4상태 집계 — detectionOnly 그룹(항목이 전부 `detected`)에는 호출하지
 * 않는다(호출부는 `detectedCount`를 쓴다). `detected`를 여기 섞으면 else
 * 분기가 그걸 `excluded`로 잘못 세므로, 안전하게 명시 분기로 막아둔다.
 */
function computeStateCounts(items: SyncItemGroupDto['items']): StateCounts {
  const counts: StateCounts = { synced: 0, pendingAdd: 0, pendingRemove: 0, excluded: 0 }
  return items.reduce((acc, item) => {
    if (item.state === 'synced') return { ...acc, synced: acc.synced + 1 }
    if (item.state === 'pending-add') return { ...acc, pendingAdd: acc.pendingAdd + 1 }
    if (item.state === 'pending-remove') return { ...acc, pendingRemove: acc.pendingRemove + 1 }
    if (item.state === 'excluded') return { ...acc, excluded: acc.excluded + 1 }
    return acc
  }, counts)
}

function mergeStateCounts(groups: readonly StateCounts[]): StateCounts {
  return groups.reduce(
    (acc, c) => ({
      synced: acc.synced + c.synced,
      pendingAdd: acc.pendingAdd + c.pendingAdd,
      pendingRemove: acc.pendingRemove + c.pendingRemove,
      excluded: acc.excluded + c.excluded
    }),
    { synced: 0, pendingAdd: 0, pendingRemove: 0, excluded: 0 }
  )
}

function groupCheckboxLabel(state: GroupToggleState): string {
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
  disabled,
  disabledReason,
  onClick
}: {
  readonly state: GroupToggleState
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
      <TooltipContent>{disabledReason ?? groupCheckboxLabel(state)}</TooltipContent>
    </Tooltip>
  )
}

interface SyncItemsViewProps {
  readonly status: EngineStatus | null
}

function SyncItemsView({ status }: SyncItemsViewProps): React.JSX.Element {
  const [groups, setGroups] = useState<SyncItemGroupDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({})
  const [pendingGroups, setPendingGroups] = useState<Record<string, boolean>>({})
  const [captureBusy, setCaptureBusy] = useState(false)
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
  // R8: follower는 capture가 막혀 있어(안전 불변식 ⑦) 이 화면의 ignore
  // 토글이 다시 커밋될 방법이 없다(copy.ts `followerToggleDisabledReason`
  // 주석 — git 재현으로 확인). 배너·집계 문구·스위치 비활성 판단 전부 이
  // 하나의 플래그로 가른다.
  const isFollower = isFollowerToggleDisabled(status?.role)

  async function refresh(): Promise<void> {
    setGroups(await window.api.engine.listSyncItems())
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

  useEffect(() => {
    const listener = (event: Event): void => {
      const route = (event as CustomEvent<ScreenshotRoute>).detail
      if (route === 'items-bulk-delete' || route === 'items-delete-confirm') {
        setPendingScreenshotRoute(route)
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
    for (const group of groups) {
      const items = q ? group.items.filter((i) => i.label.toLowerCase().includes(q)) : group.items
      if (items.length === 0) continue
      const detectionOnly = !!group.detectionOnly
      out.push({
        kind: 'header',
        key: `h:${group.capability}`,
        title: `${group.title} (${items.length})`,
        capability: group.capability,
        detectionOnly,
        // 그룹 토글·집계는 검색 필터와 무관하게 항상 그룹 전체를 대상으로 한다.
        groupState: computeGroupState(group.items),
        allItemKeys: group.items.map((i) => i.key),
        // R7: detectionOnly면 stateCounts는 무의미하니 안 채우고(0으로 둠)
        // detectedCount만 채운다 — 렌더가 detectionOnly 분기에서 골라 쓴다.
        stateCounts: detectionOnly
          ? { synced: 0, pendingAdd: 0, pendingRemove: 0, excluded: 0 }
          : computeStateCounts(group.items),
        detectedCount: detectionOnly ? group.items.length : 0
      })
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
          itemKey: item.key,
          label: item.label,
          description: item.description,
          managed: item.managed,
          ignored: item.ignored,
          state: item.state,
          detectionOnly,
          deleteEligible: eligibility.eligible,
          ...(eligibility.reason ? { deleteDisabledReason: eligibility.reason } : {})
        })
      }
    }
    return out
  }, [groups, query])

  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'header' ? 28 : 32),
    overscan: 16
  })

  async function toggle(
    capability: SyncItemGroupDto['capability'],
    key: string,
    ignored: boolean
  ): Promise<void> {
    const rowKey = `${capability}:${key}`
    setPendingKeys((prev) => ({ ...prev, [rowKey]: true }))
    try {
      const next = await window.api.engine.toggleIgnore({ capability, key, ignored })
      setGroups(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingKeys((prev) => ({ ...prev, [rowKey]: false }))
    }
  }

  async function toggleGroup(
    capability: SyncItemGroupDto['capability'],
    state: GroupToggleState,
    allItemKeys: readonly string[]
  ): Promise<void> {
    // 클릭 시 항상 "전부 동기화 대상"을 향해 움직인다: 이미 전부 동기화
    // 대상이면 전부 ignore로, 그 외(전부 ignore 또는 혼합)면 전부 동기화
    // 대상으로 — 표준 "전체 선택" 체크박스 관례.
    const nextIgnored = state === 'all-synced'
    setPendingGroups((prev) => ({ ...prev, [capability]: true }))
    try {
      const next = await window.api.engine.toggleIgnoreBulk({
        capability,
        keys: allItemKeys,
        ignored: nextIgnored
      })
      setGroups(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingGroups((prev) => ({ ...prev, [capability]: false }))
    }
  }

  // R6 R1: 보류 중(pending-add/pending-remove)이 있을 때 Capture로 안내한다
  // (State 층 — "다음 행동 안내"). 실제 capture-all 호출은 DiffView와 공유하는
  // captureAll() 헬퍼 하나로 처리한다.
  async function handleCapture(): Promise<void> {
    setCaptureBusy(true)
    setError(null)
    try {
      await captureAll()
      await refresh()
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
      {/* Sync/Pause는 follower에서 비활성이지만 Delete는 예외적으로 계속
          가능하다 — 이 비대칭이 실수로 보일 수 있어 별도로 설명한다(각 항목의
          Delete 버튼에도 같은 취지의 툴팁이 붙는다). */}
      {isFollower && (
        <p className="-mt-1 text-[11px] text-muted-foreground">{followerDeleteAsymmetryCopy}</p>
      )}

      {groups !== null && groups.length > 0 && (
        <p className="-mt-1 text-[11px] text-muted-foreground">
          전체: {formatSyncItemStateSummary(overallCounts, status?.role) || '해당 없음'}
        </p>
      )}

      {/* R6 R1: 보류 중 변경이 있을 때만 배너를 띄운다(0건이면 안 보임).
          R8: follower에는 이 배너를 아예 안 띄운다 — capture가 불가능한
          머신에 "Capture를 실행하세요"라고 지시하는 건 불가능한 행동 지시다
          (실사용 실패 그 자체 — follower에서 버튼을 눌러도 아무 일도 안
          일어났다). 위 intro 줄 + 항목별 role-aware 상태 설명이 "무엇을 봤는지"
          설명을 대신한다. */}
      {shouldShowPendingCaptureBanner(pendingCount, status?.role) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warn/40 bg-status-warn/10 px-3 py-2">
          <StatusText kind="warn">{pendingChangesCopy.bannerText(pendingCount)}</StatusText>
          <ActionButton
            variant="secondary"
            size="sm"
            label={buttonCopy.capture.label}
            subtitle={pendingChangesCopy.captureSubtitle}
            busy={captureBusy}
            disabled={captureBusy}
            onClick={handleCapture}
          />
        </div>
      )}

      {error && <StatusText kind="error">{error}</StatusText>}

      {groups === null ? (
        <p className="text-xs text-muted-foreground">{emptyStateCopy.loading}</p>
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
                        disabled={
                          row.detectionOnly || isFollower || !!pendingGroups[row.capability]
                        }
                        disabledReason={toggleDisabledReason(row.detectionOnly, status?.role)}
                        onClick={() => toggleGroup(row.capability, row.groupState, row.allItemKeys)}
                      />
                      <span className="font-mono">{row.title}</span>
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
                      {/* R6 R1: managed/unmanaged 아이콘 하나였던 것을 4상태
                          아이콘+라벨로 넓힌다 — "내가 고른 스위치가 실제로 manifest에
                          반영됐는지"를 상태 이름으로 직접 말해준다(색+형태 병행:
                          pending-add/remove는 같은 warn 색이지만 +/− 모양으로 구분).
                          R8: 라벨·설명은 role-aware(describeSyncItemState) — follower의
                          pending-add는 "추가 예정"이 아니라 "이 머신에만 있음"으로 보인다. */}
                      <span
                        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
                        title={`${describeSyncItemState(row.state, status?.role).label} — ${describeSyncItemState(row.state, status?.role).description}`}
                      >
                        <CandidateStateIcon state={row.state} />
                        <span className="shrink-0 font-mono text-foreground">{row.label}</span>
                        {row.description && (
                          <span className="truncate text-muted-foreground" title={row.description}>
                            — {row.description}
                          </span>
                        )}
                      </span>
                      <CandidateStateControl
                        // 사용자 명세: 3상태(Sync/Pause/Delete)가 각각 직접
                        // 선택 가능한 세그먼트 컨트롤. Sync/Pause는 기존
                        // Switch와 같은 비활성 규칙(detectionOnly·follower —
                        // toggleDisabledReason)을 그대로 따르고, Delete는
                        // 별도 판정(computeDeleteEligibility, 행 생성 시
                        // 계산됨)을 쓴다 — follower에서도 Delete는 로컬
                        // 시스템 변경이라 비활성화하지 않는다(비대칭, 위 안내
                        // 문구 참조).
                        value={
                          deleteRowKey === row.key ? 'delete' : controlValueForItem(row.ignored)
                        }
                        ariaLabel={row.label}
                        syncPauseDisabled={row.detectionOnly || isFollower || pendingKeys[row.key]}
                        syncPauseDisabledReason={toggleDisabledReason(
                          row.detectionOnly,
                          status?.role
                        )}
                        deleteEligible={row.deleteEligible}
                        deleteDisabledReason={row.deleteDisabledReason}
                        onSyncPauseChange={(next) =>
                          toggle(row.capability, row.itemKey, next === 'pause')
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
    </div>
  )
}

export default SyncItemsView
