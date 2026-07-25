/**
 * IPC 타입 계약 — main(엔진 호스트)과 renderer(React) 사이의 유일한 통로.
 * renderer는 이 파일의 타입으로만 시스템에 접근한다 (CLAUDE.md 아키텍처 규칙:
 * "renderer는 렌더만 — 시스템 접근은 전부 src/shared/의 타입드 IPC 계약을 거친다").
 *
 * 여기의 DTO 타입은 의도적으로 `src/engine`의 타입을 import하지 않고 shape를
 * 그대로 다시 적는다 — shared는 main·renderer·(나중의) CLI가 공유하는 중립
 * 경계이지 engine에 의존하는 하위 계층이 아니어야 하기 때문(엔진 쪽 타입이
 * 바뀌면 main의 핸들러가 컴파일 에러로 어긋남을 알려준다).
 */

export const IPC_CHANNELS = {
  enginePing: 'engine:ping',
  engineGetStatus: 'engine:getStatus',
  engineDiffDotfiles: 'engine:diffDotfiles',
  engineCaptureDotfiles: 'engine:captureDotfiles',
  engineDiffPackages: 'engine:diffPackages',
  engineCapturePackages: 'engine:capturePackages',
  engineDiffAppimage: 'engine:diffAppimage',
  engineCaptureAppimage: 'engine:captureAppimage',
  engineDetectDuplicates: 'engine:detectDuplicates',
  engineDetectReclassifications: 'engine:detectReclassifications',
  // P2d: settings/services/scheduled/tools/repos — 구 CLI 레이어 패리티.
  engineDiffSettings: 'engine:diffSettings',
  engineCaptureSettings: 'engine:captureSettings',
  engineDiffServices: 'engine:diffServices',
  engineCaptureServices: 'engine:captureServices',
  engineDiffScheduled: 'engine:diffScheduled',
  engineCaptureScheduled: 'engine:captureScheduled',
  engineDiffTools: 'engine:diffTools',
  engineCaptureTools: 'engine:captureTools',
  engineDiffRepos: 'engine:diffRepos',
  engineCaptureRepos: 'engine:captureRepos',
  engineGetDoctorReport: 'engine:getDoctorReport',
  engineIgnoreDoctorCheck: 'engine:ignoreDoctorCheck',
  engineListSyncItems: 'engine:listSyncItems',
  engineToggleIgnore: 'engine:toggleIgnore',
  engineApply: 'engine:apply',
  /** 실행 중 취소 (P2b 결정 ③) — 코어 단계는 cancelToken, sudo 단계는 cancel_file. */
  engineCancelApply: 'engine:cancelApply',
  /** main -> renderer 단방향 push (invoke 아님) — PlanExecutor 진행 이벤트 중계. */
  enginePlanEvent: 'engine:planEvent'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export interface EnginePingRequest {
  readonly message?: string
}

export interface EnginePingResponse {
  readonly ok: true
  readonly echo?: string
  readonly respondedAt: string
}

// ---------------------------------------------------------------------------
// engine:getStatus
// ---------------------------------------------------------------------------

export type EngineRole = 'reference' | 'follower'

export interface EngineStatus {
  readonly machineId: string
  readonly role: EngineRole
  readonly manifestDir: string
  /** true면 config.toml이 아직 없어 dev 기본값으로 떠 있다는 뜻 (온보딩 미완료). */
  readonly firstRun: boolean
}

// ---------------------------------------------------------------------------
// engine:diffDotfiles
// ---------------------------------------------------------------------------

export interface DotfilesDiffReport {
  readonly capability: 'dotfiles'
  readonly toLink: readonly string[]
  readonly contentChanged: readonly string[]
  readonly missingHome: readonly string[]
  readonly invalidStore: readonly string[]
}

// ---------------------------------------------------------------------------
// engine:captureDotfiles
// ---------------------------------------------------------------------------

export interface CaptureDotfilesRequest {
  /** true면 스토어·manifest 쓰기를 건너뛴다 (불변식 ①). */
  readonly dryRun: boolean
}

export interface DotfilesCaptureReport {
  readonly capability: 'dotfiles'
  readonly seededNew: number
  readonly copied: number
  readonly alreadyLinked: number
  readonly skippedDenylist: number
  readonly missingHome: number
  readonly skippedBrokenSymlink: number
  readonly skippedInvalidStore: number
  readonly ignored: number
  readonly notes: readonly string[]
}

// ---------------------------------------------------------------------------
// engine:diffPackages / engine:capturePackages (P2a — apt/snap/flatpak)
// ---------------------------------------------------------------------------

export interface AptDiffReportDto {
  readonly skipped: boolean
  readonly toInstall: readonly string[]
  /** 설치는 돼 있지만 manifest엔 없는 것 — "동기화 항목" 화면에서 다룬다(불변식 ⑤). */
  readonly uncaptured: readonly string[]
  readonly sourcesMissing: readonly string[]
  readonly sourcesContentChanged: readonly string[]
}

export interface SnapEntryDto {
  readonly name: string
  readonly classic: boolean
}

export interface SnapDiffReportDto {
  readonly skipped: boolean
  readonly toInstall: readonly SnapEntryDto[]
  readonly uncaptured: readonly string[]
}

export interface FlatpakRemoteEntryDto {
  readonly name: string
  readonly url: string
}

export interface FlatpakAppEntryDto {
  readonly application: string
  readonly origin: string
  readonly installation: string
}

export interface FlatpakDiffReportDto {
  readonly skipped: boolean
  readonly toAddRemotes: readonly FlatpakRemoteEntryDto[]
  readonly toInstall: readonly FlatpakAppEntryDto[]
  readonly uncaptured: readonly string[]
}

export interface PackagesDiffReport {
  readonly capability: 'packages'
  readonly apt: AptDiffReportDto
  readonly snap: SnapDiffReportDto
  readonly flatpak: FlatpakDiffReportDto
}

export interface CapturePackagesRequest {
  readonly dryRun: boolean
}

export interface AptCaptureReportDto {
  readonly skipped: boolean
  readonly manualInstalled: number
  readonly packagesInManifest: number
  readonly packagesAdded: number
  readonly sourcesCaptured: number
  readonly keyringsCaptured: number
  readonly notes: readonly string[]
}

export interface SnapCaptureReportDto {
  readonly skipped: boolean
  readonly captured: number
  readonly added: number
}

export interface FlatpakCaptureReportDto {
  readonly skipped: boolean
  readonly remotes: number
  readonly apps: number
  readonly addedRemotes: number
  readonly addedApps: number
}

export interface PackagesCaptureReport {
  readonly capability: 'packages'
  readonly apt: AptCaptureReportDto
  readonly snap: SnapCaptureReportDto
  readonly flatpak: FlatpakCaptureReportDto
}

// ---------------------------------------------------------------------------
// engine:diffAppimage / engine:captureAppimage (P2c — T3 Gear Lever)
// ---------------------------------------------------------------------------

export interface AppimagePinMismatchDto {
  readonly name: string
  readonly pinned: string
  readonly installed: string
}

export interface AppimageDiffReportDto {
  readonly skipped: boolean
  readonly toInstall: readonly string[]
  readonly pinMismatch: readonly AppimagePinMismatchDto[]
  readonly unsupportedSource: readonly string[]
  readonly uncaptured: readonly string[]
}

export interface CaptureAppimageRequest {
  readonly dryRun: boolean
}

export interface AppimageCaptureReportDto {
  readonly skipped: boolean
  readonly capturedCount: number
  readonly added: number
  readonly notes: readonly string[]
}

// ---------------------------------------------------------------------------
// engine:diffSettings / engine:captureSettings (P2d — dconf)
// ---------------------------------------------------------------------------

export interface SettingsDiffReportDto {
  readonly skipped: boolean
  readonly contentChanged: readonly string[]
}

export interface CaptureRequest {
  readonly dryRun: boolean
}

export interface SettingsCaptureReportDto {
  readonly skipped: boolean
  readonly written: number
  readonly skippedEmpty: readonly string[]
}

// ---------------------------------------------------------------------------
// engine:diffServices / engine:captureServices (P2d — systemd --user)
// ---------------------------------------------------------------------------

export interface ServicesDiffReportDto {
  readonly missing: readonly string[]
  readonly contentChanged: readonly string[]
  readonly enabledMismatch: readonly string[]
}

export interface ServicesCaptureReportDto {
  readonly captured: number
}

// ---------------------------------------------------------------------------
// engine:diffScheduled / engine:captureScheduled (P2d — cron)
// ---------------------------------------------------------------------------

export interface ScheduledDiffReportDto {
  readonly skipped: boolean
  readonly contentChanged: boolean
  readonly lineDiff: {
    readonly added: readonly string[]
    readonly removed: readonly string[]
  }
  readonly note?: string
}

export interface ScheduledCaptureReportDto {
  readonly skipped: boolean
  readonly captured: boolean
  readonly lines: number
  readonly note?: string
}

// ---------------------------------------------------------------------------
// engine:diffTools / engine:captureTools (P2d — nvm→node→npm)
// ---------------------------------------------------------------------------

export interface ToolsDiffReportDto {
  readonly skipped: boolean
  readonly toInstall: readonly string[]
  readonly nodeToInstall: string | null
  readonly nvmMissing: boolean
  readonly note?: string
}

export interface ToolsCaptureReportDto {
  readonly skipped: boolean
  readonly packagesInManifest: number
  readonly added: number
  readonly nodeVersion: string | null
  readonly note?: string
}

// ---------------------------------------------------------------------------
// engine:diffRepos / engine:captureRepos (P2d — git clone)
// ---------------------------------------------------------------------------

export interface RepoEntryDto {
  readonly path: string
  readonly url: string
  readonly branch: string
}

export interface ReposDiffReportDto {
  readonly toClone: readonly RepoEntryDto[]
  readonly manualNoUrl: readonly string[]
}

export interface ReposCaptureReportDto {
  readonly found: number
  readonly captured: number
  readonly added: number
  readonly warnings: readonly string[]
  readonly notes: readonly string[]
}

// ---------------------------------------------------------------------------
// engine:getDoctorReport / engine:ignoreDoctorCheck (P2d — 구 checks 레이어 통합)
// ---------------------------------------------------------------------------

export type DoctorCheckType = 'file' | 'apt' | 'role' | 'cmd'
export type DoctorCheckStatus = 'pass' | 'fail'

export interface DoctorCheckResultDto {
  readonly name: string
  readonly type: DoctorCheckType
  readonly target: string
  readonly result: DoctorCheckStatus
  readonly detail: string
  readonly hint?: string
}

export interface DoctorBasicDiagnosticsDto {
  readonly machineId: string
  readonly role: EngineRole
  readonly manifestDirExists: boolean
  readonly configConfigured: boolean
}

export interface DoctorAppimagePreflightDto {
  readonly gearLeverInstalled: boolean
  readonly gearLeverVersionOk: boolean | null
  readonly libfuse2t64Installed: boolean
  readonly appImageLauncherPresent: boolean
  readonly warnings: readonly string[]
}

export interface DoctorReportDto {
  readonly basic: DoctorBasicDiagnosticsDto
  readonly checks: readonly DoctorCheckResultDto[]
  readonly appimage: DoctorAppimagePreflightDto
  readonly checksVisible: boolean
  readonly exitCode: number
}

export interface IgnoreDoctorCheckRequest {
  readonly name: string
  readonly ignored: boolean
}

// ---------------------------------------------------------------------------
// engine:detectDuplicates (INV-1) / engine:detectReclassifications (정책 §5)
// ---------------------------------------------------------------------------

export type DuplicateCapabilityDto = 'apt' | 'snap' | 'flatpak' | 'appimage'

export interface DuplicateSourceItemDto {
  readonly capability: DuplicateCapabilityDto
  readonly label: string
}

export interface DuplicateWarningDto {
  readonly name: string
  readonly layers: readonly DuplicateSourceItemDto[]
  readonly ignored: boolean
}

export interface ReclassificationEventDto {
  readonly name: string
  readonly manifestedIn: DuplicateCapabilityDto
  readonly foundIn: DuplicateCapabilityDto
}

// ---------------------------------------------------------------------------
// engine:listSyncItems / engine:toggleIgnore ("동기화 항목" 화면 — P2a 결정 ⑤)
// ---------------------------------------------------------------------------

export type SyncItemCapability =
  'dotfiles' | 'apt' | 'snap' | 'flatpak' | 'appimage' | 'tools' | 'repos'

export interface SyncItemDto {
  readonly key: string
  readonly label: string
  /** manifest(effective)에 있으면 true. */
  readonly managed: boolean
  readonly ignored: boolean
}

export interface SyncItemGroupDto {
  readonly capability: SyncItemCapability
  readonly title: string
  readonly items: readonly SyncItemDto[]
  /** P2c: snap처럼 동기화 plan/apply에서 빠지고 INV-1 중복 검출용으로만 조회되는 그룹. */
  readonly detectionOnly?: boolean
}

export interface ToggleIgnoreRequest {
  readonly capability: SyncItemCapability
  readonly key: string
  readonly ignored: boolean
}

// ---------------------------------------------------------------------------
// engine:apply (+ engine:planEvent 중계) — dotfiles+packages 플랜을 합쳐 실행한다.
// ---------------------------------------------------------------------------

export interface ApplyRequest {
  /** false(기본)면 dry-run — 실제로 아무것도 변조하지 않는다 (불변식 ①). */
  readonly confirm: boolean
}

export type PlanActionStatus = 'ok' | 'failed' | 'refused' | 'planned' | 'skipped' | 'not-run'

export interface PlanActionResultDto {
  readonly capability: string
  readonly summary: string
  /** 실행 전 사용자에게 그대로 노출하는 액션 전문 (불변식 ⑥). */
  readonly commands: readonly string[]
  readonly status: PlanActionStatus
  readonly detail?: string
}

export interface PlanSummaryDto {
  readonly ok: number
  readonly failed: number
  readonly skipped: number
  readonly cancelled: number
}

export interface ApplyResponse {
  readonly results: readonly PlanActionResultDto[]
  readonly summary: PlanSummaryDto
  /**
   * plan에 privileged(sudo/pkexec) 액션이 있을 때만 채워지는 스크립트 전문
   * (P2b 결정 ⑤ — 불변식 ⑥). Apply 확인 다이얼로그가 monospace로 그대로
   * 노출해야 한다. privileged 액션이 없으면 undefined.
   */
  readonly sudoScriptPreview?: string
}

export interface PlanEventActionStart {
  readonly type: 'action_start'
  readonly index: number
  readonly total: number
  readonly desc: string
}

export interface PlanEventActionDone {
  readonly type: 'action_done'
  readonly index: number
  readonly ok: boolean
  readonly error?: string
}

export interface PlanEventSummary {
  readonly type: 'summary'
  readonly summary: PlanSummaryDto
}

export type PlanEvent = PlanEventActionStart | PlanEventActionDone | PlanEventSummary
