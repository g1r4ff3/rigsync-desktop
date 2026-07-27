/**
 * doctor 리포트 타입 — 구 repo `checks`(수동 체크리스트) 레이어
 * `_effective_checks`/`evaluate_check`/`doctor_report`(rigsync.py:1904-1963) 행동을
 * 이식한 부분(`ChecksManifest`/`CheckEntry`/`CheckResult`)과, 이번 phase에서
 * 새로 얹는 기본 진단(`BasicDiagnostics`) + capability별 preflight(현재는 T3
 * appimage 하나) 조합.
 */
import type { Role } from '../context'
import type { AppimagePreflightCheck } from '../capabilities/appimage/checks'
import type { FontsPreflightCheck } from '../capabilities/fonts/checks'
import type { EmptyFollowerCheckResult } from './emptyFollowerCheck'
import type { ManifestDirtyCheckResult } from './manifestDirtyCheck'
import type { ManualSyncNote } from './manualSyncNotes'
import type { NvidiaDriverCheckResult } from './nvidia'
import type { PortabilityCheckResult } from './portabilityCheck'
import type { SecretScanPreflightCheck } from './secretScanCheck'
import type { SelfUpdateCheck } from './selfUpdateCheck'

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
  /** fonts capability preflight — manifest 미설치/소스 미지정/fc-cache·fc-list 가용성. */
  readonly fonts: FontsPreflightCheck
  /** P4: NVRM 커널 모듈 vs dpkg 유저스페이스 드라이버 버전 불일치 체크. */
  readonly nvidia: NvidiaDriverCheckResult
  /** manifest 스토어 전체 소급 시크릿 스캔(⑥) -- capture 관문 우회분을 잡는 마지막 안전망. */
  readonly secretScan: SecretScanPreflightCheck
  /** refactor-spec-v0.2 P2: 이 머신에 적용될 스토어 콘텐츠의 다른 사용자 홈 경로 참조 탐지 (F1 재발 방지). */
  readonly portability: PortabilityCheckResult
  /**
   * refactor-spec-v0.2 P3(D2-a): manifest 작업 트리 dirty 검사 -- follower의
   * 심링크 로컬 편집이 다음 pull을 깨뜨리는 F3 병인을 경고로 표면화한다.
   * reference의 dirty는 P4가 자동 정리하므로 중립 정보로만 표시한다.
   */
  readonly manifestDirty: ManifestDirtyCheckResult
  /**
   * 수동 동기화 체크리스트 -- `common/manual-sync.toml`에서 정의되는, rigsync가
   * 자동화할 수 없어 사용자가 수동으로 맞춰야 하는 항목(런타임 변이·secret
   * 포함 설정 등). pass/fail이 없는 순수 정보성 목록이라 checks(수동 체크리스트
   * 레이어)와 달리 doctor 요약의 통과/경고/실패 집계에 들어가지 않는다.
   */
  readonly manualSyncNotes: readonly ManualSyncNote[]
  /** "빈 follower" 체크 -- follower인데 manifest가 거의 비어 있거나 원격이 없는지. */
  readonly emptyFollower: EmptyFollowerCheckResult
  /**
   * P4: rigsync 자기 자신의 AppImage가 Gear Lever 자동 업데이트 소스로 지정돼
   * 있는지 -- dev/deb 실행은 `applicable:false`로 조용히 통과.
   */
  readonly selfUpdate: SelfUpdateCheck
  /**
   * 구 repo `doctor_visible`(gui.py:588) 이식 — ignore 제외 후 checks가 하나라도
   * 있으면 true. UI가 "체크리스트" 섹션 자체를 숨길지 판단하는 데 쓴다(appimage
   * preflight·basic 진단은 이 플래그와 무관하게 항상 보인다).
   */
  readonly checksVisible: boolean
  /** checks 중 하나라도 fail이면 1 (구 repo `doctor_report`의 `exit_code`). */
  readonly exitCode: number
}
