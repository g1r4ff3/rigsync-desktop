import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { CandidateStateIcon } from '@/components/CandidateStateIcon'
import { ViewToolbar } from '@/components/ViewToolbar'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { captureAll } from '../captureAll'
import {
  buttonCopy,
  emptyStateCopy,
  formatSyncItemStateSummary,
  pendingChangesCopy,
  syncItemStateCopy
} from '../copy'
import { StatusText } from '../status'
import type { EngineStatus, SyncItemGroupDto, SyncItemState } from '../../../shared/ipc'

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
      /** 검색 필터와 무관하게 그룹 전체를 센 값(집계는 항상 전체 대상 — R6 R1). */
      readonly stateCounts: StateCounts
    }
  | {
      readonly kind: 'item'
      readonly key: string
      readonly capability: SyncItemGroupDto['capability']
      readonly itemKey: string
      readonly label: string
      readonly description?: string
      readonly ignored: boolean
      readonly state: SyncItemState
    }

function computeGroupState(items: SyncItemGroupDto['items']): GroupToggleState {
  if (items.length === 0) return 'all-synced'
  const ignoredCount = items.filter((i) => i.ignored).length
  if (ignoredCount === 0) return 'all-synced'
  if (ignoredCount === items.length) return 'all-ignored'
  return 'mixed'
}

function computeStateCounts(items: SyncItemGroupDto['items']): StateCounts {
  const counts: StateCounts = { synced: 0, pendingAdd: 0, pendingRemove: 0, excluded: 0 }
  return items.reduce((acc, item) => {
    if (item.state === 'synced') return { ...acc, synced: acc.synced + 1 }
    if (item.state === 'pending-add') return { ...acc, pendingAdd: acc.pendingAdd + 1 }
    if (item.state === 'pending-remove') return { ...acc, pendingRemove: acc.pendingRemove + 1 }
    return { ...acc, excluded: acc.excluded + 1 }
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

/** 네이티브 checkbox는 `indeterminate`를 prop이 아니라 DOM 속성으로만 지원한다. */
function GroupCheckbox({
  state,
  disabled,
  onClick
}: {
  readonly state: GroupToggleState
  readonly disabled: boolean
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
      <TooltipContent>{groupCheckboxLabel(state)}</TooltipContent>
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

  async function refresh(): Promise<void> {
    setGroups(await window.api.engine.listSyncItems())
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  // R6 R1: 화면 상단 집계는 검색 필터·그룹 구분과 무관하게 전체 항목을 센다.
  const overallCounts = useMemo<StateCounts>(
    () => mergeStateCounts((groups ?? []).map((g) => computeStateCounts(g.items))),
    [groups]
  )
  const pendingCount = overallCounts.pendingAdd + overallCounts.pendingRemove

  const rows = useMemo<Row[]>(() => {
    if (!groups) return []
    const q = query.trim().toLowerCase()
    const out: Row[] = []
    for (const group of groups) {
      const items = q ? group.items.filter((i) => i.label.toLowerCase().includes(q)) : group.items
      if (items.length === 0) continue
      out.push({
        kind: 'header',
        key: `h:${group.capability}`,
        title: `${group.title} (${items.length})`,
        capability: group.capability,
        detectionOnly: !!group.detectionOnly,
        // 그룹 토글·집계는 검색 필터와 무관하게 항상 그룹 전체를 대상으로 한다.
        groupState: computeGroupState(group.items),
        allItemKeys: group.items.map((i) => i.key),
        stateCounts: computeStateCounts(group.items)
      })
      for (const item of items) {
        out.push({
          kind: 'item',
          key: `${group.capability}:${item.key}`,
          capability: group.capability,
          itemKey: item.key,
          label: item.label,
          description: item.description,
          ignored: item.ignored,
          state: item.state
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
      </ViewToolbar>

      {groups !== null && groups.length > 0 && (
        <p className="-mt-1 text-[11px] text-muted-foreground">
          전체: {formatSyncItemStateSummary(overallCounts) || '해당 없음'}
        </p>
      )}

      {/* R6 R1: 보류 중 변경이 있을 때만 배너를 띄운다(0건이면 안 보임). */}
      {pendingCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-status-warn/40 bg-status-warn/10 px-3 py-2">
          <StatusText kind="warn">{pendingChangesCopy.bannerText(pendingCount)}</StatusText>
          <ActionButton
            variant="secondary"
            size="sm"
            label={buttonCopy.capture.label}
            subtitle={pendingChangesCopy.captureSubtitle}
            disabledReason={buttonCopy.captureDisabledFollower}
            busy={captureBusy}
            disabled={captureBusy || status?.role === 'follower'}
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
                        disabled={!!pendingGroups[row.capability]}
                        onClick={() => toggleGroup(row.capability, row.groupState, row.allItemKeys)}
                      />
                      <span className="font-mono">{row.title}</span>
                      {row.detectionOnly && (
                        <span className="text-status-muted">— detection-only</span>
                      )}
                      {/* R6 R1: 그룹 헤더 집계 — 검색 필터와 무관하게 그룹 전체 값,
                          0건인 상태는 생략해 158행짜리 그룹에서도 잡음을 줄인다. */}
                      <span className="ml-auto shrink-0 truncate font-mono text-[10px] font-normal text-muted-foreground">
                        {formatSyncItemStateSummary(row.stateCounts)}
                      </span>
                    </>
                  ) : (
                    <>
                      {/* R6 R1: managed/unmanaged 아이콘 하나였던 것을 4상태
                          아이콘+라벨로 넓힌다 — "내가 고른 스위치가 실제로 manifest에
                          반영됐는지"를 상태 이름으로 직접 말해준다(색+형태 병행:
                          pending-add/remove는 같은 warn 색이지만 +/− 모양으로 구분). */}
                      <span
                        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
                        title={`${syncItemStateCopy[row.state].label} — ${syncItemStateCopy[row.state].description}`}
                      >
                        <CandidateStateIcon state={row.state} />
                        <span className="shrink-0 font-mono text-foreground">{row.label}</span>
                        {row.description && (
                          <span className="truncate text-muted-foreground" title={row.description}>
                            — {row.description}
                          </span>
                        )}
                      </span>
                      <Switch
                        // 스크린샷 자기검수에서 발견: 그룹 체크박스는 켜짐=all-synced(포함)인데
                        // 이 스위치가 켜짐=ignored(제외)라 같은 화면에서 극성이 반대였다
                        // ("그룹 체크됨 + 항목 전부 꺼짐"이 둘 다 '동기화 대상'을 뜻하는 시각
                        // 모순). 엔진 쪽 ignore 의미는 그대로 두고 UI 표시만 반전한다 —
                        // 켜짐 = 동기화 대상에 포함(그룹 체크박스와 같은 극성).
                        checked={!row.ignored}
                        disabled={pendingKeys[row.key]}
                        onCheckedChange={(checked) => toggle(row.capability, row.itemKey, !checked)}
                        aria-label={`${row.label} 동기화 포함 토글`}
                        title={
                          row.ignored
                            ? '무시됨 — 클릭하면 동기화 대상에 포함'
                            : '동기화 대상에 포함됨 — 클릭하면 무시(제외)'
                        }
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default SyncItemsView
