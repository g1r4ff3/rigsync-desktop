import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { candidateControlCopy } from '../copy'
import type { CandidateControlValue } from '../deleteEligibility'

/**
 * Candidates 화면 항목별 3상태 컨트롤(Sync/Pause/Delete) — 사용자 명세: "3개가
 * 각각 선택 가능해야 해"(순환 클릭 아님). Radix `ToggleGroup type="single"`을
 * 완전히 controlled로 쓰면 이 요구를 그대로 만족한다: `value`는 항상 부모가
 * 정하고(`sync`/`pause`/일시적으로 `delete`), 빈 값(next==='')이 오면 그냥
 * 무시해 이미 눌려있던 버튼을 다시 눌러도 꺼지지 않는다(Radix single 기본
 * 동작은 재클릭 시 해제하지만, controlled value를 안 바꾸면 다음 렌더에서
 * 그대로 되돌아간다).
 *
 * Delete는 지속 상태가 아니라 1회성 행동이라 `onDeleteRequest`만 부르고
 * `onSyncPauseChange`는 절대 호출하지 않는다 — 실제로 삭제가 실행되기 전까지
 * "선택됨"이 영구히 남지 않는다(부모가 다이얼로그 열려있는 동안만 시각적으로
 * `value="delete"`를 넘겨 보여줄 수 있다 — SyncItemsView 참조).
 */
export interface CandidateStateControlProps {
  readonly value: CandidateControlValue | 'delete'
  readonly ariaLabel: string
  readonly syncPauseDisabled: boolean
  readonly syncPauseDisabledReason?: string
  readonly deleteEligible: boolean
  readonly deleteDisabledReason?: string
  readonly onSyncPauseChange: (next: CandidateControlValue) => void
  readonly onDeleteRequest: () => void
}

export function CandidateStateControl({
  value,
  ariaLabel,
  syncPauseDisabled,
  syncPauseDisabledReason,
  deleteEligible,
  deleteDisabledReason,
  onSyncPauseChange,
  onDeleteRequest
}: CandidateStateControlProps): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      value={value}
      aria-label={ariaLabel}
      onValueChange={(next) => {
        if (!next) return
        if (next === 'delete') onDeleteRequest()
        else onSyncPauseChange(next as CandidateControlValue)
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="sync"
            disabled={syncPauseDisabled}
            aria-label={`${ariaLabel} — ${candidateControlCopy.sync.label}`}
          >
            {candidateControlCopy.sync.label}
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>
          {syncPauseDisabled ? syncPauseDisabledReason : candidateControlCopy.sync.tooltip}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="pause"
            disabled={syncPauseDisabled}
            aria-label={`${ariaLabel} — ${candidateControlCopy.pause.label}`}
          >
            {candidateControlCopy.pause.label}
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>
          {syncPauseDisabled ? syncPauseDisabledReason : candidateControlCopy.pause.tooltip}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <ToggleGroupItem
            value="delete"
            tone="destructive"
            disabled={!deleteEligible}
            aria-label={`${ariaLabel} — ${candidateControlCopy.delete.label}`}
          >
            {candidateControlCopy.delete.label}
          </ToggleGroupItem>
        </TooltipTrigger>
        <TooltipContent>
          {!deleteEligible ? deleteDisabledReason : candidateControlCopy.delete.tooltip}
        </TooltipContent>
      </Tooltip>
    </ToggleGroup>
  )
}
