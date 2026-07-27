import { cn } from '@/lib/utils'

/**
 * R# UI 정돈 — 스켈레톤 상태 (shadcn 표준 컴포넌트, 그대로 채택 — CLAUDE.md
 * "컴포넌트는 shadcn/ui에서 가져온다"). v0.1.15 워커 분리로 창은 안 멈추지만
 * 워커 큐잉으로 "불러오는 중"이 길어질 수 있어, 탭 전환 시 빈 화면·레이아웃
 * 점프 대신 컨텐츠 형태를 암시하는 자리표시자를 보여준다.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  )
}

export { Skeleton }
