import {
  Ban,
  CheckCircle2,
  Circle,
  CircleSlash,
  MinusCircle,
  Package,
  PlusCircle
} from 'lucide-react'
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
  excluded: Circle,
  // R7: detection-only(snap) 항목 — excluded와 같은 중립 모양(Circle)을 쓰지만
  // 별개 개념이다(excluded=ignore로 안정적으로 빠짐, detected=애초에 동기화
  // 대상권 밖). 색은 같은 muted라 라벨/툴팁 문구로 구분한다(syncItemStateCopy).
  detected: Circle,
  // refactor-spec-v0.2 §1: 배포판 기본 판정 — 분류가 뺀 안정 상태. excluded/
  // detected와 같은 muted 색이지만 모양(Package)으로 "배포판 구성물"임을 가른다
  // (색만으로 구분 금지 규칙).
  'distro-default': Package,
  // v0.1.20 4번: capture가 담을 수 없는 항목 — pending-add(PlusCircle)와
  // 모양으로 명확히 구분한다(색만으로 구분 금지 규칙 — pending-add도 warn이라
  // 색으로는 안 갈린다).
  unresolvable: Ban,
  // WS2("창고 모델" 구독): 중성적 표현(구독 해제를 나타내는 슬래시) + 흐림
  // (muted 색) — excluded(Circle·muted)와 겹치지 않도록 모양을 가른다.
  'not-subscribed': CircleSlash
} as const

const COLOR_CLASS_BY_STATE: Record<SyncItemState, string> = {
  synced: 'text-status-ok',
  'pending-add': 'text-status-warn',
  'pending-remove': 'text-status-warn',
  excluded: 'text-status-muted',
  detected: 'text-status-muted',
  'distro-default': 'text-status-muted',
  unresolvable: 'text-status-warn',
  'not-subscribed': 'text-status-muted'
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
