import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'

/**
 * 3상태 세그먼트 컨트롤(Candidates 화면 Sync/Pause/Delete) 전용 — shadcn
 * toggle-group을 이 프로젝트의 `radix-ui` 메타 패키지 import 스타일(다른
 * ui/*.tsx와 동일 — switch.tsx/dialog.tsx 참조)에 맞춰 옮겼다. `type="single"`
 * 이면 셋 다 직접 선택 가능(순환 클릭 아님)하고 항상 정확히 하나만 활성 —
 * 사용자 명세("3개가 각각 선택 가능해야 해")에 맞는 컴포넌트다.
 */
const toggleGroupItemVariants = cva(
  "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-sm px-2 py-1 text-xs font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      tone: {
        default: '',
        /** Delete 항목 전용 — 활성일 때만 destructive 색으로 바뀐다(danger 이중 인코딩). */
        destructive: 'data-[state=on]:bg-destructive data-[state=on]:text-white'
      }
    },
    defaultVariants: { tone: 'default' }
  }
)

function ToggleGroup({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>): React.JSX.Element {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-border bg-muted p-0.5',
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  tone,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof toggleGroupItemVariants>): React.JSX.Element {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ tone }), className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
