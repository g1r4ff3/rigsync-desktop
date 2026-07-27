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

// ---------------------------------------------------------------------------
// 내용 수준 비밀 스캔 — capability 여러 곳(dotfiles/scheduled/services capture,
// doctor secret scan)이 공유하는 finding shape. **원문 값은 절대 담지 않는다**
// (경로+줄 번호+패턴 종류+마스킹된 발췌만 — src/engine/safety/secretScan.ts 참조).
// ---------------------------------------------------------------------------

export type SecretPatternKindDto =
  | 'github-pat'
  | 'aws-access-key'
  | 'slack-token'
  | 'google-api-key'
  | 'anthropic-api-key'
  | 'openai-api-key'
  | 'pem-private-key'
  | 'generic-secret-assignment'

export interface SecretFindingDto {
  readonly path: string
  readonly line: number
  readonly kind: SecretPatternKindDto
  readonly confidence: 'high' | 'medium'
  readonly label: string
  readonly maskedExcerpt: string
}

export const IPC_CHANNELS = {
  enginePing: 'engine:ping',
  engineGetStatus: 'engine:getStatus',
  engineDiffDotfiles: 'engine:diffDotfiles',
  engineCaptureDotfiles: 'engine:captureDotfiles',
  engineDiffPackages: 'engine:diffPackages',
  engineCapturePackages: 'engine:capturePackages',
  engineDiffAppimage: 'engine:diffAppimage',
  engineCaptureAppimage: 'engine:captureAppimage',
  engineDiffFonts: 'engine:diffFonts',
  engineCaptureFonts: 'engine:captureFonts',
  engineDiffBinaries: 'engine:diffBinaries',
  engineCaptureBinaries: 'engine:captureBinaries',
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
  // P3: 트레이 상주 drift 체크 — 스케줄러가 메모리에 든 마지막 결과 조회 +
  // 트레이 알림 클릭 시 main -> renderer로 "Diff 탭으로 전환" push.
  engineGetLastDriftCheck: 'engine:getLastDriftCheck',
  engineFocusDiffTab: 'engine:focusDiffTab',
  // P4: 온보딩 위저드 + git 전송 + autostart.
  engineCompleteOnboarding: 'engine:completeOnboarding',
  engineGetSyncStatus: 'engine:getSyncStatus',
  engineSyncNow: 'engine:syncNow',
  engineSetAutostart: 'engine:setAutostart',
  /**
   * 실사용 결함 수정: 온보딩 "기존 경로 지정"이 무검증이라 follower가 빈
   * 로컬 디렉터리를 가리켜도 조용히 정상처럼 보였다. 경고만 만들고 진행은
   * 막지 않는다(코디네이터 지시).
   */
  engineValidateManifestPath: 'engine:validateManifestPath',
  /** Settings에서도 클론으로 복구할 수 있게 하는 진입점 (온보딩과 별개). */
  engineCloneManifestRepo: 'engine:cloneManifestRepo',
  // R1: 첫 실행 이후 설정 화면 — writeConfigFile을 재사용해 저장.
  engineGetConfig: 'engine:getConfig',
  engineUpdateConfig: 'engine:updateConfig',
  engineListSyncItems: 'engine:listSyncItems',
  engineToggleIgnore: 'engine:toggleIgnore',
  // R5: Candidates 그룹 전체 토글 — ignore.toml 1회 읽기/쓰기 + 자동 커밋도 1회.
  engineToggleIgnoreBulk: 'engine:toggleIgnoreBulk',
  /**
   * F2(docs/refactor-spec-v0.2.md) "이 머신 전용" 전환 — dotfiles·services
   * 항목을 common ↔ hosts/<machineId> manifest 계층 사이로 옮긴다
   * (engine/hostLayerMove.ts). ignore 토글과 달리 manifest를 **즉시** 바꾼다
   * (다음 Capture를 기다리지 않음) — 계층 소속 자체가 이동 대상이라 "보류"
   * 개념이 성립하지 않는다.
   */
  engineMoveEntryToHostLayer: 'engine:moveEntryToHostLayer',
  engineMoveEntryToCommonLayer: 'engine:moveEntryToCommonLayer',
  engineApply: 'engine:apply',
  /** 실행 중 취소 (P2b 결정 ③) — 코어 단계는 cancelToken, sudo 단계는 cancel_file. */
  engineCancelApply: 'engine:cancelApply',
  /**
   * 항목 삭제(uninstall, 안전 불변식 5) — Candidates 화면의 3상태 컨트롤이
   * "Delete"를 고르면 항상 이 두 채널을 순서대로 탄다: 먼저 planUninstall로
   * dry-run 미리보기(명령 전문·제외 사유·apt 의존성 경고)를 확인 다이얼로그에
   * 노출하고, 사용자가 확인하면 runUninstall이 실제로 실행한다. 실행은
   * `engine:apply`와 같은 ApplyRunner·`engine:planEvent` 이벤트 스트림·
   * `engine:cancelApply` 취소 경로를 그대로 재사용한다(엔진 실행기 하나만
   * 존재 — 동시에 apply와 uninstall을 같이 실행하는 흐름은 없다는 전제).
   */
  enginePlanUninstall: 'engine:planUninstall',
  engineRunUninstall: 'engine:runUninstall',
  /** main -> renderer 단방향 push (invoke 아님) — PlanExecutor 진행 이벤트 중계. */
  enginePlanEvent: 'engine:planEvent',
  /**
   * R4: dev 전용 스크린샷 하네스(main/screenshot.ts)가 renderer에 "이 화면으로
   * 가라"고 지시하는 단방향 push. `RIGSYNC_SCREENSHOT_DIR` env가 있을 때만
   * main이 이 채널로 보낸다 — 평상시 앱 동작에는 전혀 관여하지 않는다.
   */
  engineScreenshotGoto: 'engine:screenshotGoto'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// ---------------------------------------------------------------------------
// window:* — 커스텀 타이틀바(frame:false) 창 제어. engine:* 채널과 분리한
// 이유: 엔진 워커(EngineWorkerClient)를 거치지 않고 main 프로세스가
// BrowserWindow를 직접 조작하는 순수 UI 관심사이기 때문(UI 정돈 — 커스텀
// 타이틀바, v0.1.16).
// ---------------------------------------------------------------------------
export const WINDOW_IPC_CHANNELS = {
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',
  /** main -> renderer push: 최대화/복원 상태가 바뀔 때(타이틀바 아이콘 토글용). */
  windowMaximizeChanged: 'window:maximizeChanged'
} as const

export type WindowIpcChannel = (typeof WINDOW_IPC_CHANNELS)[keyof typeof WINDOW_IPC_CHANNELS]

/** engine:screenshotGoto 페이로드 — App.tsx가 이 이름으로 탭/온보딩/다이얼로그를 강제 전환한다. */
export type ScreenshotRoute =
  | 'onboarding'
  /** 온보딩 화면을 강제 표시하되 manifest storage 선택을 'clone'으로 미리 맞춰 보여준다. */
  | 'onboarding-clone'
  | 'diff'
  | 'items'
  | 'doctor'
  | 'settings'
  | 'apply-dialog'
  /** 항목 삭제 검증 전용 — Candidates에서 삭제 가능한 첫 항목의 확인 다이얼로그를 강제로 연다. */
  | 'items-delete-confirm'
  /** 항목 삭제 검증 전용 — Candidates의 일괄 삭제 체크리스트를 강제로 연다. */
  | 'items-bulk-delete'
  /** refactor-spec-v0.2 §1 검증 전용 — Candidates를 "배포판 기본" 그룹 헤더로 스크롤(접힌 상태). */
  | 'items-distro'
  /** 위와 같되 그룹을 펼친 상태로 — distro-default 상태 행들이 보이게. */
  | 'items-distro-open'

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
  readonly autostartEnabled: boolean
}

// ---------------------------------------------------------------------------
// engine:completeOnboarding (P4 온보딩 위저드)
// ---------------------------------------------------------------------------

/**
 * R2: 구 rigsync 마이그레이션 옵션은 제거됐다(사용자 결정 — fresh capture로 충분).
 * 'clone'은 실사용 결함 수정으로 추가됐다 — follower의 정상 진입 경로는
 * 기준 저장소를 클론해 받는 것인데 그때까지 그 경로가 없었다.
 */
export type ManifestSourceMode = 'new' | 'existing' | 'clone'

export interface CompleteOnboardingRequest {
  readonly machineId: string
  readonly role: EngineRole
  readonly manifestDir: string
  readonly manifestSource: ManifestSourceMode
  /** manifestSource==='clone'일 때만 사용 -- 클론할 저장소 URL. */
  readonly repoUrl?: string
  readonly profile?: string
  readonly autostartEnabled: boolean
}

export interface CompleteOnboardingResponse {
  readonly status: EngineStatus
}

// ---------------------------------------------------------------------------
// engine:validateManifestPath (온보딩 "기존 경로 지정" 검증 — 경고만, 진행은 막지 않음)
// ---------------------------------------------------------------------------

export interface ValidateManifestPathRequest {
  readonly manifestDir: string
}

export interface ManifestPathCheckDto {
  readonly exists: boolean
  readonly isGitRepo: boolean
  readonly hasRemote: boolean
  readonly hasManifestStructure: boolean
  readonly warnings: readonly string[]
}

// ---------------------------------------------------------------------------
// engine:cloneManifestRepo (Settings에서도 클론으로 복구)
// ---------------------------------------------------------------------------

export interface CloneManifestRepoRequest {
  readonly repoUrl: string
  readonly manifestDir: string
}

export interface CloneManifestRepoResponse {
  readonly ok: boolean
  /** ok===false일 때만 채워지는 사람이 읽는 실패 안내문. */
  readonly error?: string
  /** ok===true일 때 갱신된 config -- Settings가 다시 조회하지 않고 바로 반영. */
  readonly config?: RigsyncConfigDto
}

// ---------------------------------------------------------------------------
// engine:getSyncStatus / engine:syncNow (P4 — git 전송, "git은 보이지 않는다")
// ---------------------------------------------------------------------------

export type SyncStatusDto =
  | { readonly kind: 'local-only' }
  | { readonly kind: 'synced' }
  | { readonly kind: 'behind'; readonly behindBy: number }
  | { readonly kind: 'error'; readonly message: string }

// ---------------------------------------------------------------------------
// engine:setAutostart (P4 — XDG autostart 토글)
// ---------------------------------------------------------------------------

export interface SetAutostartRequest {
  readonly enabled: boolean
}

// ---------------------------------------------------------------------------
// engine:getConfig / engine:updateConfig (R1 — 첫 실행 이후 설정 화면)
// ---------------------------------------------------------------------------

export interface RigsyncConfigDto {
  readonly machineId: string
  readonly role: EngineRole
  readonly manifestDir: string
  readonly profile?: string
  readonly autostartEnabled: boolean
  readonly driftCheckIntervalHours: number
}

export type UpdateConfigRequest = RigsyncConfigDto

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

export interface DotfilesSecretScanBlockedEntryDto {
  readonly home: string
  readonly findings: readonly SecretFindingDto[]
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
  /** 내용 수준 비밀 스캔에 걸려 스토어·manifest 어느 쪽에도 담기지 않은 entry 수. */
  readonly skippedSecretScan: number
  readonly secretScanBlocked: readonly DotfilesSecretScanBlockedEntryDto[]
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
// engine:diffFonts / engine:captureFonts (fonts capability — 2026-07-26)
// ---------------------------------------------------------------------------

export interface FontsPinMismatchDto {
  readonly name: string
  readonly pinned: string
  readonly installedVersion: string
}

export interface FontsDiffReportDto {
  readonly toInstall: readonly string[]
  readonly pinMismatch: readonly FontsPinMismatchDto[]
  readonly uncaptured: readonly string[]
}

export interface CaptureFontsRequest {
  readonly dryRun: boolean
}

export interface FontsCaptureReportDto {
  readonly capturedCount: number
  readonly added: number
  readonly notes: readonly string[]
}

// ---------------------------------------------------------------------------
// engine:diffBinaries / engine:captureBinaries (binaries capability — 2026-07-26)
// ---------------------------------------------------------------------------

export interface BinariesPinMismatchDto {
  readonly name: string
  readonly pinned: string
  readonly installedVersion: string
}

export interface BinariesDiffReportDto {
  readonly toInstall: readonly string[]
  readonly pinMismatch: readonly BinariesPinMismatchDto[]
  readonly uncaptured: readonly string[]
}

export interface CaptureBinariesRequest {
  readonly dryRun: boolean
}

export interface BinariesCaptureReportDto {
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

export interface ServicesSecretScanBlockedEntryDto {
  readonly name: string
  readonly findings: readonly SecretFindingDto[]
}

export interface ServicesCaptureReportDto {
  readonly captured: number
  readonly skippedSecretScan: number
  readonly secretScanBlocked: readonly ServicesSecretScanBlockedEntryDto[]
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
  /** 내용 수준 비밀 스캔에 걸려 캡처가 통째로 차단됐는지 (파일 단위 계약이라 부분 캡처 없음). */
  readonly secretScanBlocked: readonly SecretFindingDto[]
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

/** P4: NVRM 커널 모듈 vs dpkg 유저스페이스 드라이버 버전 불일치 체크. */
export interface DoctorNvidiaCheckDto {
  readonly applicable: boolean
  readonly nvrmVersion: string | null
  readonly userspaceVersion: string | null
  readonly matched: boolean
  readonly warning?: string
}

/** fonts capability preflight — doctor 체크 3종(미설치/소스 미지정/fc-cache·fc-list). */
export interface DoctorFontsPreflightDto {
  readonly missingInstalled: readonly string[]
  readonly unresolvedInstalled: readonly string[]
  readonly fcCacheAvailable: boolean
  readonly fcListAvailable: boolean
  readonly warnings: readonly string[]
}

/**
 * refactor-spec-v0.2 F5(P5): binaries capability preflight — 레지스트리
 * 미등록 + 버전성 파일명 실행파일 경고("binaries도 fonts와 동일 구조").
 */
export interface DoctorBinariesPreflightDto {
  readonly unresolvedInstalled: readonly string[]
  readonly warnings: readonly string[]
}

/** manifest 스토어 전체 소급 시크릿 스캔(⑥) -- capture 관문 우회분을 잡는 마지막 안전망. */
export interface DoctorSecretScanPreflightDto {
  readonly blockedFindings: readonly SecretFindingDto[]
  readonly warnings: readonly string[]
}

/**
 * refactor-spec-v0.2 P2: 이식성 검사 — 이 머신에 적용될 manifest 스토어
 * 콘텐츠(dotfiles·crontab·services 유닛)에서 다른 사용자의 `/home/<이름>`
 * 참조를 찾는다. F1 사고(머신 고유 절대경로가 든 cron·유닛이 follower에
 * 배포돼 실파손) 재발 방지.
 */
export interface DoctorPortabilityFindingDto {
  readonly path: string
  readonly line: number
  readonly foreignUser: string
  readonly excerpt: string
}

export interface DoctorPortabilityDto {
  readonly findings: readonly DoctorPortabilityFindingDto[]
  readonly warnings: readonly string[]
}

/**
 * apt PATH shadowing 검사 — 관리(managed) apt 패키지가 dpkg로 설치돼 있는데
 * PATH 해석 순서상 같은 이름의 dpkg 밖(비관리) 실행파일이 먼저 잡히는 경우
 * (rclone 공식 설치 스크립트 실증 사례 재발 방지). planApt의 설치 전 경고
 * (Apply plan의 commands 미리보기)와 자매 기능 — 이쪽은 "이미 관리 중인
 * 패키지가 계속 가려지고 있는" 상시 상태를 Doctor에서 본다.
 */
export interface DoctorAptShadowFindingDto {
  readonly packageName: string
  readonly shadowingPath: string
  readonly dpkgOwnedPath: string
  readonly resolveCommand: string
}

export interface DoctorAptShadowDto {
  readonly findings: readonly DoctorAptShadowFindingDto[]
  readonly warnings: readonly string[]
}

/**
 * refactor-spec-v0.2 P3(D2-a): manifest 작업 트리 dirty 검사 -- follower의
 * 심링크 로컬 편집이 다음 pull을 깨뜨리는 F3 병인. follower는 warning(경고),
 * reference는 note(P4가 자동 정리하므로 중립 정보)로 표현이 갈린다.
 */
export interface DoctorManifestDirtyFileDto {
  readonly status: string
  readonly path: string
}

export interface DoctorManifestDirtyDto {
  readonly role: 'reference' | 'follower'
  readonly dirty: boolean
  readonly files: readonly DoctorManifestDirtyFileDto[]
  readonly warning?: string
  readonly note?: string
}

/**
 * 수동 동기화 체크리스트 항목 -- `common/manual-sync.toml`의 `[[note]]`
 * 엔트리 하나. rigsync가 자동화하지 않는(런타임 변이·secret 포함 등) 설정을
 * 사용자가 수동으로 맞춰야 한다는 것을 Doctor에 표출한다.
 */
export interface ManualSyncNoteDto {
  readonly id: string
  readonly title: string
  readonly detail: string
}

/**
 * 실사용 결함 수정: follower인데 manifest가 거의 비어 있거나(선언 0건)
 * 원격이 연결돼 있지 않으면 경고한다 — reference의 빈 manifest(첫 capture 전)는
 * 정상이라 `applicable`이 role==='follower'일 때만 true다.
 */
export interface DoctorEmptyFollowerDto {
  readonly applicable: boolean
  readonly declarationsTotal: number
  readonly hasRemote: boolean
  readonly warning?: string
}

export interface DoctorReportDto {
  readonly basic: DoctorBasicDiagnosticsDto
  readonly checks: readonly DoctorCheckResultDto[]
  readonly appimage: DoctorAppimagePreflightDto
  readonly fonts: DoctorFontsPreflightDto
  readonly binaries: DoctorBinariesPreflightDto
  readonly nvidia: DoctorNvidiaCheckDto
  readonly secretScan: DoctorSecretScanPreflightDto
  readonly portability: DoctorPortabilityDto
  readonly aptShadow: DoctorAptShadowDto
  readonly manifestDirty: DoctorManifestDirtyDto
  readonly manualSyncNotes: readonly ManualSyncNoteDto[]
  readonly emptyFollower: DoctorEmptyFollowerDto
  readonly checksVisible: boolean
  readonly exitCode: number
}

export interface IgnoreDoctorCheckRequest {
  readonly name: string
  readonly ignored: boolean
}

// ---------------------------------------------------------------------------
// engine:getLastDriftCheck (P3 — 트레이 상주 스케줄러의 마지막 결과 조회)
// ---------------------------------------------------------------------------

export interface DriftSummaryDto {
  readonly checkedAt: string
  readonly total: number
  readonly byCapability: Readonly<Record<string, number>>
  readonly hash: string
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
  | 'dotfiles'
  | 'apt'
  | 'snap'
  | 'flatpak'
  | 'appimage'
  | 'fonts'
  | 'binaries'
  | 'tools'
  | 'repos'
  /**
   * F2: dotfiles와 함께 host 계층 이동(HostLayerCapability)을 지원하는 두
   * capability 중 하나 — services 그룹은 이 화면에 "이 머신 전용" 전환을
   * 보여주기 위해서만 존재한다(다른 그룹처럼 unmanaged 후보 탐지·ignore를
   * 지원하지 않는다 — 항상 managed=true·ignored=false, `HOST_LAYER_CAPABILITIES`
   * 참조).
   */
  | 'services'

/** F2(docs/refactor-spec-v0.2.md): host 계층 이동을 지원하는 capability. */
export type HostLayerCapability = 'dotfiles' | 'services'

export const HOST_LAYER_CAPABILITIES: readonly HostLayerCapability[] = ['dotfiles', 'services']

export function isHostLayerCapability(
  capability: SyncItemCapability
): capability is HostLayerCapability {
  return (HOST_LAYER_CAPABILITIES as readonly string[]).includes(capability)
}

/**
 * R6 R1 4상태(managed×ignored)는 ignore를 지원하는 capability만 의미가 있다.
 * services 그룹은 ignore 메커니즘이 아예 없다(captureServices가 ignore.toml을
 * 참조하지 않는다 — engine/capabilities/services/capture.ts 확인) — 그래서
 * 이 그룹의 Sync/Pause 컨트롤·그룹 체크박스는 항상 비활성이다(눌러도 관찰
 * 가능한 효과가 없다는 게 detectionOnly 그룹과 같은 이유 — copy.ts
 * `ignoreUnsupportedReason` 참조). Delete는 별도로 이미
 * `UNINSTALL_SUPPORTED_CAPABILITIES`가 services를 안 담아 비활성이다.
 */
export const IGNORE_UNSUPPORTED_CAPABILITIES: readonly SyncItemCapability[] = ['services']

export function isIgnoreUnsupportedCapability(capability: SyncItemCapability): boolean {
  return (IGNORE_UNSUPPORTED_CAPABILITIES as readonly string[]).includes(capability)
}

/**
 * R6 R1: Candidates 4상태 모델 — managed × ignored 조합의 의미(engine
 * `computeSyncItemState`의 판정을 그대로 실어 보낸다. 자세한 설명은
 * src/engine/syncItems.ts 참조):
 * synced=지금 동기화 중, pending-add=다음 Capture가 추가, pending-remove=다음
 * Capture가 제거, excluded=ignore돼 안정적으로 빠진 상태.
 * R7: detected=detection-only 그룹(snap) 소속 항목의 유일한 상태 — managed×
 * ignored와 무관하게 `withSyncItemState`가 덮어쓴다(snap은 plan/apply에서
 * 빠져 있어 나머지 네 상태의 "다음 Capture가 어떻게 바꿀지" 질문 자체가
 * 성립하지 않는다).
 */
/**
 * refactor-spec-v0.2 §1이 더한 `distro-default`: apt "배포판 기본" 그룹의
 * 미관리·미포함 항목 — **분류가** 자동 추가 대상에서 뺀 안정 상태(사용자
 * ignore인 `excluded`와 구분). 스위치를 켜면 include 예외가 되어
 * pending-add로 간다.
 */
export type SyncItemState =
  'synced' | 'pending-add' | 'pending-remove' | 'excluded' | 'detected' | 'distro-default'

export interface SyncItemDto {
  readonly key: string
  readonly label: string
  /** manifest(effective)에 있으면 true. */
  readonly managed: boolean
  readonly ignored: boolean
  /** refactor-spec-v0.2 §1: apt 배포판 판정 항목의 include 예외 여부 (apt 그룹만). */
  readonly included?: boolean
  readonly state: SyncItemState
  /** R6 R2: 이 항목이 무엇인지 한 줄 설명 — 출처가 없으면 undefined(추측하지 않는다). */
  readonly description?: string
  /**
   * F2: 이 항목이 지금 이 머신의 host 계층(hosts/<machineId>)에 있으면 true —
   * "이 머신 전용"으로 배포되고 다른 머신에는 이 항목 자체가 보이지 않는다는
   * 뜻. `HOST_LAYER_CAPABILITIES` 밖의 capability(apt 등)에서는 항상
   * undefined(그 개념이 없다 — 추측하지 않는다, description과 같은 원칙).
   */
  readonly hostOnly?: boolean
}

/** refactor-spec-v0.2 §1: apt가 무상태 분류로 갈라진 두 그룹의 식별자. */
export type SyncItemSubgroup = 'apt-user' | 'apt-distro'

export interface SyncItemGroupDto {
  readonly capability: SyncItemCapability
  readonly title: string
  readonly items: readonly SyncItemDto[]
  /** P2c: snap처럼 동기화 plan/apply에서 빠지고 INV-1 중복 검출용으로만 조회되는 그룹. */
  readonly detectionOnly?: boolean
  /** refactor-spec-v0.2 §1: 있으면 apt 분류 그룹 — 토글 라우팅·상태 의미가 갈린다. */
  readonly subgroup?: SyncItemSubgroup
  /** UI가 처음에 접어서 보여줄 그룹 (펼치기 가능 — 절대 숨기지 않는다). */
  readonly collapsedByDefault?: boolean
}

export interface ToggleIgnoreRequest {
  readonly capability: SyncItemCapability
  readonly key: string
  readonly ignored: boolean
  /**
   * refactor-spec-v0.2 §1: `apt-distro` 그룹에서 온 토글이면 main이 ignore
   * 대신 include 예외 경로(`toggleAptDistroSyncedBulk`)로 라우팅한다.
   */
  readonly subgroup?: SyncItemSubgroup
}

/**
 * R5: Candidates 그룹 전체 토글 — ignore.toml을 항목 수만큼 여러 번 읽고
 * 쓰지 않고 **1회 읽기 -> 일괄 수정 -> 1회 쓰기**로 처리한다(그래야 자동
 * commit+push도 항목당이 아니라 1커밋으로 끝난다 — main/ipc.ts 주석 참조).
 */
export interface ToggleIgnoreBulkRequest {
  readonly capability: SyncItemCapability
  readonly keys: readonly string[]
  readonly ignored: boolean
  /** ToggleIgnoreRequest.subgroup과 동일 — apt-distro면 include 경로로 라우팅. */
  readonly subgroup?: SyncItemSubgroup
}

/**
 * F2: "이 머신 전용" 전환 요청 — `engine:moveEntryToHostLayer`/
 * `engine:moveEntryToCommonLayer` 둘 다 이 shape을 쓴다(방향은 채널로
 * 갈린다, ToggleIgnoreRequest의 ignored 플래그 대신 채널을 나눈 이유:
 * 이동은 ignore처럼 "다음 Capture가 반영할 방향"이 아니라 manifest를
 * 즉시 바꾸는 저작 행위라 요청 자체에 방향을 싣기보다 채널명이 더
 * 명확하다고 판단했다).
 */
export interface MoveEntryHostLayerRequest {
  readonly capability: HostLayerCapability
  readonly key: string
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

// ---------------------------------------------------------------------------
// engine:planUninstall / engine:runUninstall (항목 삭제 — 안전 불변식 5)
// ---------------------------------------------------------------------------

export interface UninstallItemRequestDto {
  readonly capability: SyncItemCapability
  readonly key: string
}

/** 요청했지만 계획에 담기지 않은 항목 — 왜 빠졌는지를 사용자에게 정직하게 보여준다. */
export interface UninstallExclusionDto {
  readonly capability: string
  readonly key: string
  readonly reason: string
}

/** apt 삭제가 다른 패키지까지 함께 제거할 때의 경고(안전 불변식 5 필수 조건). */
export interface AptRemoveDependencyReportDto {
  readonly requested: readonly string[]
  readonly willRemove: readonly string[]
  readonly extra: readonly string[]
}

export interface PlanUninstallRequest {
  readonly items: readonly UninstallItemRequestDto[]
}

export interface PlanUninstallResponse {
  /** 실행될 명령 전문 미리보기 — status는 항상 'planned'(불변식 ⑥). */
  readonly actions: readonly PlanActionResultDto[]
  readonly excluded: readonly UninstallExclusionDto[]
  readonly aptDependencies?: AptRemoveDependencyReportDto
  /** privileged 액션(sudo apt remove 등)이 있을 때만 채워지는 스크립트 전문. */
  readonly sudoScriptPreview?: string
}

export interface RunUninstallRequest {
  readonly items: readonly UninstallItemRequestDto[]
}

export interface RunUninstallResponse {
  readonly results: readonly PlanActionResultDto[]
  readonly summary: PlanSummaryDto
}
