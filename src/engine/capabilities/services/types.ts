/**
 * services(systemd --user) 레이어 manifest 스키마 + capture/diff 리포트 타입.
 * 구 repo `capture_services`/`diff_services`/`plan_services`(rigsync.py:1542-1610)
 * 행동을 옮긴 것(코드 복사 아님).
 */

export interface ServiceUnitEntry {
  readonly name: string
  /** manifestDir 기준 상대 스토어 경로 (예: "services/systemd-user/<name>"). */
  readonly file: string
  readonly enabled: boolean
}

export interface ServicesManifest {
  readonly unit?: readonly ServiceUnitEntry[]
}

export interface ServicesCaptureReport {
  readonly captured: number
}

export interface ServicesDiffReport {
  readonly missing: readonly string[]
  readonly contentChanged: readonly string[]
  /**
   * 구 repo는 "enabled 불일치"를 `content_changed`에 문자열로 섞어 인코딩했다
   * (`"<name> (enabled true != false)"`). 이 repo는 diff 소비자(UI·plan)가 구조화된
   * 값을 쓸 수 있도록 별도 필드로 분리한다 — 정책이 명시적으로 허용한 "정직한
   * 개선"(라인 수준 diff 개선과 같은 종류).
   */
  readonly enabledMismatch: readonly string[]
}
