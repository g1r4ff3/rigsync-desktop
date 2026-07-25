import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ViewToolbar } from '@/components/ViewToolbar'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { emptyStateCopy } from '../copy'
import { StatusIcon, StatusText } from '../status'
import type { SyncItemGroupDto } from '../../../shared/ipc'

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
 * R4 스코프 결정: 개별 항목 스위치(수백 개까지 가는 가상 스크롤 목록)는
 * shadcn Tooltip을 안 쓰고 네이티브 `title` 속성만 쓴다 — 행마다 Radix
 * Portal을 띄우면 가상 스크롤 성능이 떨어지고, 항목 각각의 설명이 라벨
 * 자체로 이미 자명하다(이름 그대로). 구조적 컨트롤(검색창·그룹 체크박스)에는
 * 전부 shadcn Tooltip을 붙인다.
 */

type GroupToggleState = 'all-synced' | 'all-ignored' | 'mixed'

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
    }
  | {
      readonly kind: 'item'
      readonly key: string
      readonly capability: SyncItemGroupDto['capability']
      readonly itemKey: string
      readonly label: string
      readonly managed: boolean
      readonly ignored: boolean
    }

function computeGroupState(items: SyncItemGroupDto['items']): GroupToggleState {
  if (items.length === 0) return 'all-synced'
  const ignoredCount = items.filter((i) => i.ignored).length
  if (ignoredCount === 0) return 'all-synced'
  if (ignoredCount === items.length) return 'all-ignored'
  return 'mixed'
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

function SyncItemsView(): React.JSX.Element {
  const [groups, setGroups] = useState<SyncItemGroupDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({})
  const [pendingGroups, setPendingGroups] = useState<Record<string, boolean>>({})

  async function refresh(): Promise<void> {
    setGroups(await window.api.engine.listSyncItems())
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

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
        // 그룹 토글은 검색 필터와 무관하게 항상 그룹 전체를 대상으로 한다.
        groupState: computeGroupState(group.items),
        allItemKeys: group.items.map((i) => i.key)
      })
      for (const item of items) {
        out.push({
          kind: 'item',
          key: `${group.capability}:${item.key}`,
          capability: group.capability,
          itemKey: item.key,
          label: item.label,
          managed: item.managed,
          ignored: item.ignored
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
                      : 'flex items-center justify-between border-t border-border px-2 font-mono text-xs'
                  }
                >
                  {row.kind === 'header' ? (
                    <>
                      <GroupCheckbox
                        state={row.groupState}
                        disabled={!!pendingGroups[row.capability]}
                        onClick={() => toggleGroup(row.capability, row.groupState, row.allItemKeys)}
                      />
                      <span>{row.title}</span>
                      {row.detectionOnly && (
                        <span className="text-status-muted">— detection-only</span>
                      )}
                    </>
                  ) : (
                    <>
                      {/* R4-2 #4: 예전엔 미관리 항목마다 "(candidate)" 텍스트를 반복해
                          붙였는데, 이미 색(muted vs foreground)으로도 같은 정보를
                          중복 전달하고 있어 "반복되는 상수"로 읽혔다(158행 전부가
                          미관리인 화면에서 특히). 색만으로 구분하면 안 되므로
                          (Design constraints) 텍스트 라벨을 지우는 대신 아이콘 형태
                          (check vs 빈 원)로 바꿔 managed/unmanaged를 계속 색+형태
                          두 채널로 인코딩한다 — 노이즈 없이. */}
                      <span
                        className="flex min-w-0 items-center gap-1.5"
                        title={
                          row.managed
                            ? '관리 중 — manifest에 기록됨'
                            : '미관리 후보 — 아직 manifest에 없음'
                        }
                      >
                        <StatusIcon kind={row.managed ? 'ok' : 'muted'} className="size-3" />
                        <span className={row.managed ? 'text-foreground' : 'text-muted-foreground'}>
                          {row.label}
                        </span>
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
