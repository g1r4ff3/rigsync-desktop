import { cn } from '@/lib/utils'

/**
 * R1b — 5개 화면(Differences·Candidates·Doctor·Settings·Onboarding)이 공유하는
 * 툴바 골격: 좌측 정렬 한 줄(help + 액션/컨트롤). 이전에는 화면마다
 * `justify-between`으로 액션을 오른쪽 끝에 붙였는데, 그러면 액션이 작용하는
 * 대상(요약·목록)과 시각적으로 멀어지고 가운데에 의미 없는 빈 띠가 생겼다
 * (사용자 지적: Differences 탭 Capture/Apply). 액션은 그것이 속한 컨텍스트
 * 옆에 두는 게 원칙이므로 전부 좌측 정렬 한 줄로 통일한다.
 */
export function ViewToolbar({
  children,
  className
}: {
  readonly children: React.ReactNode
  readonly className?: string
}): React.JSX.Element {
  return <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)}>{children}</div>
}
