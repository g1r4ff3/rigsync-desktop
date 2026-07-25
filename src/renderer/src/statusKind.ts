/**
 * 상태 색+형태 공용 인코딩의 순수 로직 절반 — CLAUDE.md Design constraints
 * "상태는 색+형태로 인코딩(색만으로 구분 금지)". 컴포넌트(StatusIcon/
 * StatusText)는 `status.tsx`에 따로 둔다(react-refresh/only-export-components
 * 규칙 — 컴포넌트 파일은 컴포넌트만 export해야 Fast Refresh가 안전하다).
 *
 * 새 상태를 추가하고 싶으면 여기 5종(`StatusKind`) 중 하나로 매핑하고 절대
 * 새 색상을 만들지 않는다(5색 고정 계약 — "warn"은 새 색이 아니라 danger의
 * 저채도 알파 변형이고, 아이콘 모양(삼각형)으로 error(X)와 구분한다).
 */
export type StatusKind = 'ok' | 'warn' | 'error' | 'muted' | 'running'

/** plan/apply 액션 상태(PlanActionStatus + 'running') -> 5종 상태 매핑. */
export function planActionStatusKind(
  status: 'ok' | 'failed' | 'refused' | 'planned' | 'skipped' | 'not-run' | 'running' | '?'
): StatusKind {
  switch (status) {
    case 'ok':
      return 'ok'
    case 'failed':
    case 'refused':
      return 'error'
    case 'running':
      return 'running'
    case 'skipped':
      return 'warn'
    case 'planned':
    case 'not-run':
    default:
      return 'muted'
  }
}

/** git 전송 상태(SyncStatusDto.kind) -> 5종 상태 매핑. */
export function syncStatusKind(kind: 'local-only' | 'synced' | 'behind' | 'error'): StatusKind {
  if (kind === 'synced') return 'ok'
  if (kind === 'behind') return 'warn'
  if (kind === 'error') return 'error'
  return 'muted'
}

/** doctor 체크 결과(pass/fail) -> 5종 상태 매핑. */
export function doctorResultKind(result: 'pass' | 'fail'): StatusKind {
  return result === 'pass' ? 'ok' : 'error'
}
