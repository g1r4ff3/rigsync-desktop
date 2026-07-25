import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonCopy } from '../copy'

/**
 * Explanability 계약 ①+② 결합 컴포넌트 — 모든 버튼이 이 하나를 통해서만
 * 렌더된다: 한 줄 설명(①)은 호버 시 툴팁으로, 비활성 상태에선 같은 자리에
 * "왜 비활성인지"로 바뀐다(②). 개별 화면이 매번 두 레이어를 손으로 맞추지
 * 않도록 여기 한 곳에서 강제한다.
 *
 * R1b: 이전에는 부제를 버튼 아래 항상 보이는 별도 줄로도 렌더했는데, 툴바
 * 한 줄이 라벨+부제 두 줄로 두꺼워져 "버튼 아래 세로로 두꺼운 빈 띠"(사용자
 * 지적 사례)의 원인 중 하나였다. 설명 자체는 사라지지 않고(여전히 이
 * 컴포넌트가 유일한 소비처) 위치만 툴팁 하나로 합쳤다 — 정보 밀도 원칙.
 *
 * `disabled`는 흔히 "진행 중(busy)"과 "도메인 조건 미충족"이라는 서로 다른
 * 이유를 OR로 합쳐 만든다(예: `disabled={busy || !hasDrift}`). 이때
 * `disabledReason`만 쓰면 실제로는 busy라서 비활성인데도 도메인 사유("follower는
 * capture 불가" 등)가 뜨는 오설명이 생긴다(R4 스크린샷 자기검수에서 실제 발견).
 * `busy` prop을 따로 받아 그 경우엔 공용 busyReason을 우선한다.
 */
export interface ActionButtonProps {
  readonly label: string
  readonly subtitle: string
  /** disabled일 때 subtitle 대신 툴팁에 보여줄 "왜 비활성인지" 설명. */
  readonly disabledReason?: string
  /** true면(그리고 disabled도 true면) disabledReason 대신 공용 진행-중 문구를 보여준다. */
  readonly busy?: boolean
  readonly onClick?: () => void
  readonly disabled?: boolean
  readonly variant?: React.ComponentProps<typeof Button>['variant']
  readonly size?: React.ComponentProps<typeof Button>['size']
  readonly className?: string
}

export function ActionButton({
  label,
  subtitle,
  disabledReason,
  busy,
  onClick,
  disabled,
  variant,
  size,
  className
}: ActionButtonProps): React.JSX.Element {
  const tooltipText = !disabled
    ? subtitle
    : busy
      ? buttonCopy.busyReason
      : (disabledReason ?? subtitle)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          onClick={onClick}
          className={className}
        >
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  )
}
