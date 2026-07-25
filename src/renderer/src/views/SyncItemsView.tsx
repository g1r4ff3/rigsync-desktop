import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import type { SyncItemGroupDto } from '../../../shared/ipc'

/**
 * "동기화 항목" 화면(P2a 결정 ⑤) — managed(manifest)/unmanaged(설치는 됐지만
 * 미기록) 항목을 provider·capability별로 나열하고, 스위치로 ignore를 토글한다.
 * apt 하나만도 족히 100개가 넘어갈 수 있어(구 GTK GUI의 실제 약점) 검색 필터 +
 * `@tanstack/react-virtual` 가상 스크롤이 필수다.
 */

type Row =
  | { readonly kind: 'header'; readonly key: string; readonly title: string }
  | {
      readonly kind: 'item'
      readonly key: string
      readonly capability: SyncItemGroupDto['capability']
      readonly itemKey: string
      readonly label: string
      readonly managed: boolean
      readonly ignored: boolean
    }

function SyncItemsView(): React.JSX.Element {
  const [groups, setGroups] = useState<SyncItemGroupDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({})

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
        title: `${group.title} (${items.length})`
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

  return (
    <div className="flex h-full flex-col gap-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="검색…"
        className="rounded border border-border bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-neutral-600"
      />

      {error && <p className="font-mono text-xs text-red-400">error: {error}</p>}

      {groups === null ? (
        <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
      ) : rows.length === 0 ? (
        <p className="font-mono text-xs text-neutral-500">
          {query ? '검색 결과 없음' : '동기화 대상 항목이 없습니다.'}
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
                      ? 'flex items-center bg-secondary px-2 font-mono text-xs font-semibold text-secondary-foreground'
                      : 'flex items-center justify-between border-t border-border px-2 font-mono text-xs'
                  }
                >
                  {row.kind === 'header' ? (
                    row.title
                  ) : (
                    <>
                      <span className={row.managed ? 'text-foreground' : 'text-neutral-500'}>
                        {row.label}
                        {!row.managed && (
                          <span className="ml-2 text-neutral-600">(미관리 후보)</span>
                        )}
                      </span>
                      <Switch
                        checked={row.ignored}
                        disabled={pendingKeys[row.key]}
                        onCheckedChange={(checked) => toggle(row.capability, row.itemKey, checked)}
                        aria-label={`${row.label} ignore 토글`}
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
