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
  engineListSyncItems: 'engine:listSyncItems',
  engineToggleIgnore: 'engine:toggleIgnore',
  engineApply: 'engine:apply',
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
// engine:listSyncItems / engine:toggleIgnore ("동기화 항목" 화면 — P2a 결정 ⑤)
// ---------------------------------------------------------------------------

export type SyncItemCapability = 'dotfiles' | 'apt' | 'snap' | 'flatpak'

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
