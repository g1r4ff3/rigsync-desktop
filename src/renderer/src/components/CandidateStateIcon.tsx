import { CheckCircle2, Circle, MinusCircle, PlusCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SyncItemState } from '../../../shared/ipc'

/**
 * R6 R1: Candidates 4상태(managed × ignored) 전용 아이콘 — 화면(status.tsx)의
 * 공용 5종 StatusKind 팔레트를 그대로 재사용하되(CLAUDE.md "절대 새 색상을
 * 만들지 않는다"), 아이콘 모양은 이 도메인에 맞게 따로 고른다: pending-add/
 * pending-remove 둘 다 "다음 Capture가 바꾼다"는 같은 의미라 같은 색(warn)을
 * 쓰지만, +/− 아이콘으로 방향을 가른다(색만으로 구분하지 않는다).
 */
const ICON_BY_STATE = {
  synced: CheckCircle2,
  'pending-add': PlusCircle,
  'pending-remove': MinusCircle,
  excluded: Circle
} as const

const COLOR_CLASS_BY_STATE: Record<SyncItemState, string> = {
  synced: 'text-status-ok',
  'pending-add': 'text-status-warn',
  'pending-remove': 'text-status-warn',
  excluded: 'text-status-muted'
}

export function CandidateStateIcon({
  state,
  className
}: {
  readonly state: SyncItemState
  readonly className?: string
}): React.JSX.Element {
  const Icon = ICON_BY_STATE[state]
  return (
    <Icon
      className={cn('size-3.5 shrink-0', COLOR_CLASS_BY_STATE[state], className)}
      aria-hidden="true"
    />
  )
}
