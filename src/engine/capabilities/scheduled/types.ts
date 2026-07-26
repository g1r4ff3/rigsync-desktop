/**
 * scheduled(cron) 리포트 타입. 구 repo `capture_cron`/`diff_cron`/`plan_cron`
 * (rigsync.py:1613-1655) 행동을 옮긴 것(코드 복사 아님).
 */
import type { SecretFinding } from '../../safety/secretScan'

export interface ScheduledCaptureReport {
  readonly skipped: boolean
  readonly captured: boolean
  readonly lines: number
  readonly note?: string
  /** 내용 수준 비밀 스캔에 걸려 캡처가 통째로 차단됐는지 (파일 단위 계약이라 부분 캡처 없음). */
  readonly secretScanBlocked: readonly SecretFinding[]
}

/**
 * `lineDiff`는 정책이 명시적으로 허용한 개선("파일 단위 계약은 유지하되 diff에서
 * 라인 수준 차이를 보여주는 개선은 허용") — 캡처·적용은 여전히 파일 전체
 * 단위지만, 사용자가 "뭐가 바뀌었는지"를 보는 diff 표시는 라인 단위로 세분화한다.
 */
export interface ScheduledDiffReport {
  readonly skipped: boolean
  readonly contentChanged: boolean
  readonly lineDiff: {
    readonly added: readonly string[]
    readonly removed: readonly string[]
  }
  readonly note?: string
}
