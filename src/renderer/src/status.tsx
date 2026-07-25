import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StatusKind } from './statusKind'

/**
 * 상태 색+형태 공용 인코딩의 컴포넌트 절반 — 매핑 로직은 `statusKind.ts`.
 * 이 두 컴포넌트가 전 화면의 유일한 상태 렌더 소비처다.
 */

const ICON_BY_KIND = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  muted: Circle,
  running: Loader2
} as const

const COLOR_CLASS_BY_KIND: Record<StatusKind, string> = {
  ok: 'text-status-ok',
  warn: 'text-status-warn',
  error: 'text-status-error',
  muted: 'text-status-muted',
  running: 'text-status-running'
}

export function StatusIcon({
  kind,
  className
}: {
  readonly kind: StatusKind
  readonly className?: string
}): React.JSX.Element {
  const Icon = ICON_BY_KIND[kind]
  return (
    <Icon
      className={cn(
        'size-3.5 shrink-0',
        COLOR_CLASS_BY_KIND[kind],
        kind === 'running' && 'animate-spin',
        className
      )}
      aria-hidden="true"
    />
  )
}

export function StatusText({
  kind,
  children,
  className
}: {
  readonly kind: StatusKind
  readonly children: React.ReactNode
  readonly className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-xs',
        COLOR_CLASS_BY_KIND[kind],
        className
      )}
    >
      <StatusIcon kind={kind} />
      {children}
    </span>
  )
}
