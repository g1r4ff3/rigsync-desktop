/**
 * doctor 리포트 타입 — 구 repo `checks`(수동 체크리스트) 레이어
 * `_effective_checks`/`evaluate_check`/`doctor_report`(rigsync.py:1904-1963) 행동을
 * 이식한 부분(`ChecksManifest`/`CheckEntry`/`CheckResult`)과, 이번 phase에서
 * 새로 얹는 기본 진단(`BasicDiagnostics`) + capability별 preflight(현재는 T3
 * appimage 하나) 조합.
 */
import type { Role } from '../context'
import type { AppimagePreflightCheck } from '../capabilities/appimage/checks'
import type { NvidiaDriverCheckResult } from './nvidia'

export type CheckType = 'file' | 'apt' | 'role' | 'cmd'

export interface CheckEntry {
  readonly name: string
  readonly type: CheckType
  readonly target: string
  readonly hint?: string
  /** `cmd` 타입 전용: 출력에 이 문자열이 포함돼야 pass (없으면 종료코드만 본다). */
  readonly expect?: string
}

export interface ChecksManifest {
  readonly check?: readonly CheckEntry[]
}

export type CheckResultStatus = 'pass' | 'fail'

export interface CheckResult {
  readonly name: string
  readonly type: CheckType
  readonly target: string
  readonly result: CheckResultStatus
  readonly detail: string
  readonly hint?: string
}

/**
 * 구 repo에는 없던 새 진단 — machine-id/role/manifest 존재 등 "설정이 됐는가"
 * 자체를 doctor 첫 화면에 보여준다(P2d 요구사항).
 */
export interface BasicDiagnostics {
  readonly machineId: string
  readonly role: Role
  readonly manifestDirExists: boolean
  /** true면 config.toml이 실제로 존재(온보딩 완료) -- resolveContext의 firstRun 반전. */
  readonly configConfigured: boolean
}

export interface DoctorReport {
  readonly basic: BasicDiagnostics
  readonly checks: readonly CheckResult[]
  readonly appimage: AppimagePreflightCheck
  /** P4: NVRM 커널 모듈 vs dpkg 유저스페이스 드라이버 버전 불일치 체크. */
  readonly nvidia: NvidiaDriverCheckResult
  /**
   * 구 repo `doctor_visible`(gui.py:588) 이식 — ignore 제외 후 checks가 하나라도
   * 있으면 true. UI가 "체크리스트" 섹션 자체를 숨길지 판단하는 데 쓴다(appimage
   * preflight·basic 진단은 이 플래그와 무관하게 항상 보인다).
   */
  readonly checksVisible: boolean
  /** checks 중 하나라도 fail이면 1 (구 repo `doctor_report`의 `exit_code`). */
  readonly exitCode: number
}
