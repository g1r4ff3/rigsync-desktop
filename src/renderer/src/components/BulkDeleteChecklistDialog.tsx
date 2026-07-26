import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { bulkDeleteCopy } from '../copy'
import type { DeletableItem } from '../deleteEligibility'

function itemKey(item: DeletableItem): string {
  return `${item.capability}:${item.key}`
}

/**
 * 일괄 삭제 1단계 — 사용자 명세: "일괄 삭제는 전체 목록을 먼저 보여주고 그
 * 중에서 체크리스트처럼 취소 가능해야 해." 기본은 전체 선택, 검색으로
 * 좁히고 개별 해제할 수 있다. 대상이 수십~수백 개일 수 있어 Candidates
 * 목록과 같은 가상 스크롤 패턴을 재사용한다.
 *
 * "Continue"를 누르면 선택된 항목만 들고 부모가 `DeleteConfirmDialog`를 연다
 * (명령 전문·apt 의존성 경고는 그 다음 단계에서 보여준다 — 여기는 순수
 * 대상 선별 단계).
 */
export interface BulkDeleteChecklistDialogProps {
  readonly items: readonly DeletableItem[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onContinue: (selected: readonly DeletableItem[]) => void
}

export function BulkDeleteChecklistDialog({
  items,
  open,
  onOpenChange,
  onContinue
}: BulkDeleteChecklistDialogProps): React.JSX.Element {
  // 기본은 전체 선택 — 부모(SyncItemsView)가 열 때마다 `key`를 바꿔 이
  // 컴포넌트를 리마운트하므로(DeleteConfirmDialog와 같은 패턴) 여기서는
  // effect로 리셋할 필요 없이 lazy initializer 한 번이면 충분하다.
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [itemKey(i), true]))
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.capability.toLowerCase().includes(q)
    )
  }, [items, query])

  const selectedItems = useMemo(() => items.filter((i) => checked[itemKey(i)]), [items, checked])

  const byCapability = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of selectedItems) counts.set(i.capability, (counts.get(i.capability) ?? 0) + 1)
    return [...counts.entries()]
  }, [selectedItems])

  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 16,
    // Dialog는 SyncItemsView 본문(always-mounted, definite height 상속)과
    // 달리 매번 새로 마운트되는 Radix Portal 콘텐츠라 첫 렌더 시점에
    // ResizeObserver 측정이 아직 안 끝나 있을 수 있다(실측: totalSize는
    // 정상 계산되는데 getVirtualItems()가 빈 배열 — 스크린샷 자기검수에서
    // 발견). `initialRect`로 실측 전 폴백 크기를 줘서 첫 렌더부터 항목이
    // 보이게 한다(실측이 끝나면 실제 크기로 갱신됨).
    initialRect: { width: 400, height: 288 }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{bulkDeleteCopy.dialogTitle}</DialogTitle>
          <DialogDescription>{bulkDeleteCopy.dialogDescription(items.length)}</DialogDescription>
        </DialogHeader>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={bulkDeleteCopy.searchPlaceholder}
          className="rounded border border-border bg-transparent px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />

        <p className="text-[11px] text-muted-foreground">
          {selectedItems.length}
          {bulkDeleteCopy.selectedCountSuffix}
          {byCapability.length > 0 &&
            ` (${byCapability.map(([cap, n]) => `${cap} ${n}`).join(' · ')})`}
        </p>

        {/* flex-1로 남는 공간을 채우게 하면(전 스크린샷 라운드에서 실제로
            발견) DialogContent가 `max-h-[80vh]`(정의된 height가 아니라
            cap일 뿐)만 갖고 있어 flex column의 cross-axis 높이가 불확정
            상태가 되고, `flex-basis:0`인 이 컨테이너가 실측 높이 0으로
            붕괴해 tanstack-virtual이 `getVirtualItems()`를 빈 배열로
            돌려준다(행이 하나도 안 그려짐 — 스크롤 영역만 빈 채로 보임).
            고정 `max-h`(+overflow-y-auto)로 바꿔 부모 flex 레이아웃의
            확정성과 무관하게 항상 실제 높이를 갖게 한다. */}
        <div ref={parentRef} className="max-h-72 overflow-y-auto rounded border border-border">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = filtered[virtualRow.index]
              const key = itemKey(item)
              return (
                <div
                  key={key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                  className="flex items-center gap-2 border-t border-border px-2 text-xs first:border-t-0"
                >
                  <Checkbox
                    checked={!!checked[key]}
                    onCheckedChange={(next) =>
                      setChecked((prev) => ({ ...prev, [key]: next === true }))
                    }
                    aria-label={`${item.label} 삭제 대상에 포함`}
                  />
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    [{item.capability}]
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                    {item.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <DialogFooter>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                {bulkDeleteCopy.cancelButton.label}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{bulkDeleteCopy.cancelButton.subtitle}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="destructive"
                disabled={selectedItems.length === 0}
                onClick={() => onContinue(selectedItems)}
              >
                {bulkDeleteCopy.continueButton.label}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {selectedItems.length === 0
                ? bulkDeleteCopy.continueDisabledEmpty
                : bulkDeleteCopy.continueButton.subtitle}
            </TooltipContent>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
