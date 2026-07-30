/**
 * engine IPC 핸들러 등록 — main 프로세스에서 딱 한 번 호출한다(`app.whenReady`
 * 안에서). `ipcMain.handle`은 같은 채널에 두 번 등록하면 던지므로, 창이
 * (macOS activate로) 다시 만들어져도 여기는 재실행되지 않는다 — 창 참조는
 * `getMainWindow` 콜백으로 늦게 묶는다(P1 확정 결정 ⑤·⑥).
 *
 * **성능 리팩토링 2단계(perf: 엔진 utilityProcess 분리)**: 실제 엔진 실행
 * (diff/capture/apply/doctor 등)은 전부 `src/main/engineWorker.ts`가 별도
 * `utilityProcess`에서 수행한다 — 이 파일은 이제 각 IPC 채널을
 * `EngineWorkerClient.call()`로 그대로 넘기는 **얇은 프록시**다(1단계에서
 * 추가한 `handle()` 소요시간 계측 래퍼는 그대로 유지 — 워커 왕복 시간까지
 * 포함해 재는 게 오히려 정확하다). electron 전용 파생값(`is.dev`·execPath)이
 * 필요한 메서드(온보딩·autostart·config 갱신)만 요청 payload에 실어 보낸다
 * — 워커 안에서는 `electron.app`이 없어 `@electron-toolkit/utils`의 `is.dev`를
 * 못 쓰기 때문(engineWorker.ts 파일 헤더 주석 참조).
 *
 * P2a: packages capability(apt/snap/flatpak)가 추가되면서 `engine:apply`는
 * dotfiles + packages 두 capability의 plan을 합쳐 실행한다.
 * P2b: 그 실행은 이제 `ApplyRunner`(src/engine/elevation)가 맡는다 — 비특권
 * 액션은 기존 PlanExecutor로, 특권 액션(apt/snap install 등)은 pkexec 스크립트
 * 하나로 묶어 실행한다.
 * P2c: T3 appimage(Gear Lever)도 diff/capture/apply에 합류. INV-1 중복 검출과
 * 정책 §5 재분류 감지는 조회 전용 엔드포인트로 노출한다.
 * P2d: settings(dconf)/services(systemd --user)/scheduled(cron)/tools(nvm)/
 * repos(git)가 합류해 구 CLI와 레이어 패리티가 된다. doctor는 새 조회 전용
 * 엔드포인트(checks 레이어 + 기본 진단 + appimage preflight 통합).
 */
import { join } from 'node:path'
import { ipcMain, type BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { resolveContext, type RigsyncContext } from '../engine/context'
import { EngineWorkerClient } from './engineWorkerClient'
import {
  IPC_CHANNELS,
  type ApplyRequest,
  type ApplyResponse,
  type AppimageCaptureReportDto,
  type AppimageDiffReportDto,
  type BinariesCaptureReportDto,
  type BinariesDiffReportDto,
  type CaptureAppimageRequest,
  type CaptureBinariesRequest,
  type CaptureDotfilesRequest,
  type CaptureFontsRequest,
  type CapturePackagesRequest,
  type CaptureRequest,
  type CloneManifestRepoRequest,
  type CloneManifestRepoResponse,
  type CompleteOnboardingRequest,
  type CompleteOnboardingResponse,
  type DoctorReportDto,
  type DriftSummaryDto,
  type DotfilesCaptureReport,
  type DotfilesDiffReport,
  type DuplicateWarningDto,
  type EngineStatus,
  type FontsCaptureReportDto,
  type FontsDiffReportDto,
  type IgnoreDoctorCheckRequest,
  type ListEntrySubscribersRequest,
  type ManifestPathCheckDto,
  type MoveEntryHostLayerRequest,
  type PackagesCaptureReport,
  type PackagesDiffReport,
  type PlanUninstallRequest,
  type PlanUninstallResponse,
  type ReclassificationEventDto,
  type RegisterEntryRequest,
  type RegisterEntryResponse,
  type ReposCaptureReportDto,
  type ReposDiffReportDto,
  type RigsyncConfigDto,
  type RunUninstallRequest,
  type RunUninstallResponse,
  type ScheduledCaptureReportDto,
  type ScheduledDiffReportDto,
  type SelectionMode,
  type ServicesCaptureReportDto,
  type ServicesDiffReportDto,
  type SetAutostartRequest,
  type SetSelectionModeRequest,
  type SettingsCaptureReportDto,
  type SettingsDiffReportDto,
  type SyncItemGroupDto,
  type SyncStatusDto,
  type ToggleIgnoreBulkRequest,
  type ToggleIgnoreRequest,
  type ToggleSubscribeBulkRequest,
  type ToggleSubscribeRequest,
  type ToolsCaptureReportDto,
  type ToolsDiffReportDto,
  type UnregisterEntryRequest,
  type UpdateConfigRequest,
  type ValidateManifestPathRequest
} from '../shared/ipc'

// main 쪽 가벼운 ctx 사본 -- 트레이·스케줄러가 필요로 하는 값(homeDir·
// driftCheckIntervalHours 등)만 쓰고, 실제 엔진 실행(diff/capture/apply)과는
// 완전히 분리돼 있다(그건 engineWorker.ts가 자기 프로세스 안에서 따로
// resolveContext()한다). 둘 다 같은 config.toml을 읽으므로 내용은 항상
// 일치하고, 이 사본은 그저 "워커까지 왕복 안 해도 되는 저렴한 조회용"이다.
let localCtx = resolveContext()

/** index.ts(스케줄러/트레이 배선)가 쓰는 가벼운 ctx 조회 — 워커를 거치지 않는다. */
export function getEngineContext(): RigsyncContext {
  return localCtx.ctx
}

/** 온보딩/설정 변경 후 main 쪽 ctx 사본을 다시 읽는다. */
export function refreshEngineContext(): void {
  localCtx = resolveContext()
}

/**
 * 성능 계측(1단계) — IPC 핸들러 하나가 얼마나 걸렸는지 100ms 초과일 때만
 * 로그로 남긴다(전량 로깅은 소음이라 과하다). `ipcMain.handle`을 그대로
 * 감싸므로 채널별 요청/응답 타입 추론은 그대로 유지된다. 2단계(워커 분리)
 * 이후에도 이 래퍼는 그대로 남는다 — 이제는 "워커 왕복 포함 총 소요시간"을
 * 재는 셈인데, 그게 오히려 사용자 체감(응답까지 걸리는 시간)과 더 가깝다.
 */
function handle<Args extends unknown[], R>(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => Promise<R>
): void {
  ipcMain.handle(channel, async (event, ...args: Args) => {
    const start = performance.now()
    try {
      return await listener(event, ...args)
    } finally {
      const ms = performance.now() - start
      if (ms > 100) console.log(`[ipc] ${channel} took ${ms.toFixed(0)}ms`)
    }
  })
}

let client: EngineWorkerClient | null = null

/** registerEngineIpc가 한 번 호출될 때 워커를 fork한다 (app.whenReady 이후에만 가능). */
function getClient(getMainWindow: () => BrowserWindow | null): EngineWorkerClient {
  if (client) return client
  const modulePath = join(__dirname, 'engineWorker.js')
  client = new EngineWorkerClient({
    modulePath,
    onEvent: (channel, payload) => {
      getMainWindow()?.webContents.send(channel, payload)
    }
  })
  return client
}

/** 앱 종료(`before-quit`)에서 호출 — 워커가 죽어가는 앱 위에 재기동되지 않게 한다. */
export function disposeEngineWorker(): void {
  client?.dispose()
}

/**
 * P3 드리프트 스케줄러(main/driftCheck.ts의 `runDriftCheck`)도 워커 경유로
 * 실행한다 — 전 capability read-only diff라 엔진 실행이고, main 이벤트
 * 루프를 블록시키지 않아야 하는 이유(응답 없음 증상)가 IPC 핸들러들과
 * 동일하다. `registerEngineIpc()`가 최초 1회 호출된 뒤에만 쓸 수 있다
 * (index.ts가 그 순서를 보장 — scheduler는 만들어지지만 실제 첫 체크는
 * 5분 뒤에나 실행되므로 그 사이 registerEngineIpc가 반드시 먼저 끝난다).
 */
export function runEngineDriftCheck(): Promise<DriftSummaryDto> {
  if (!client) throw new Error('엔진 워커가 아직 초기화되지 않음 (registerEngineIpc 호출 전)')
  return client.call<DriftSummaryDto>('runDriftCheck')
}

export interface RegisterEngineIpcDeps {
  /** P3: 스케줄러 인스턴스는 index.ts가 소유한다 — ipc.ts는 조회 콜백만 받는다. */
  readonly getLastDriftCheck?: () => DriftSummaryDto | null
  /** P4: 온보딩 완료(config.toml 신규 작성) 후 index.ts가 스케줄러를 재생성하도록 알린다. */
  readonly onConfigChanged?: () => void
  /** P4: autostart .desktop의 Exec= 값 — 패키징 형태에 따라 index.ts가 결정해 넘긴다. */
  readonly getExecPath?: () => string
}

export function registerEngineIpc(
  getMainWindow: () => BrowserWindow | null,
  deps: RegisterEngineIpcDeps = {}
): void {
  const getLastDriftCheck = deps.getLastDriftCheck ?? ((): DriftSummaryDto | null => null)
  const onConfigChanged = deps.onConfigChanged ?? ((): void => {})
  const getExecPath = deps.getExecPath ?? ((): string => process.execPath)
  const worker = getClient(getMainWindow)

  /** electron 전용 파생값(execPath/isDev)을 요청에 실어 보내는 헬퍼 — completeOnboarding/setAutostart/updateConfig 전용. */
  function withElevationDeps<T extends object>(
    request: T
  ): T & { execPath: string; isDev: boolean } {
    return { ...request, execPath: getExecPath(), isDev: is.dev }
  }

  handle(IPC_CHANNELS.engineGetStatus, async (): Promise<EngineStatus> => worker.call('getStatus'))

  handle(IPC_CHANNELS.engineDiffDotfiles, async (): Promise<DotfilesDiffReport> =>
    worker.call('diffDotfiles')
  )
  handle(
    IPC_CHANNELS.engineCaptureDotfiles,
    async (_event, request: CaptureDotfilesRequest): Promise<DotfilesCaptureReport> =>
      worker.call('captureDotfiles', request)
  )

  handle(IPC_CHANNELS.engineDiffPackages, async (): Promise<PackagesDiffReport> =>
    worker.call('diffPackages')
  )
  handle(
    IPC_CHANNELS.engineCapturePackages,
    async (_event, request: CapturePackagesRequest): Promise<PackagesCaptureReport> =>
      worker.call('capturePackages', request)
  )

  handle(IPC_CHANNELS.engineDiffAppimage, async (): Promise<AppimageDiffReportDto> =>
    worker.call('diffAppimage')
  )
  handle(
    IPC_CHANNELS.engineCaptureAppimage,
    async (_event, request: CaptureAppimageRequest): Promise<AppimageCaptureReportDto> =>
      worker.call('captureAppimage', request)
  )

  handle(IPC_CHANNELS.engineDiffFonts, async (): Promise<FontsDiffReportDto> =>
    worker.call('diffFonts')
  )
  handle(
    IPC_CHANNELS.engineCaptureFonts,
    async (_event, request: CaptureFontsRequest): Promise<FontsCaptureReportDto> =>
      worker.call('captureFonts', request)
  )

  handle(IPC_CHANNELS.engineDiffBinaries, async (): Promise<BinariesDiffReportDto> =>
    worker.call('diffBinaries')
  )
  handle(
    IPC_CHANNELS.engineCaptureBinaries,
    async (_event, request: CaptureBinariesRequest): Promise<BinariesCaptureReportDto> =>
      worker.call('captureBinaries', request)
  )

  handle(IPC_CHANNELS.engineDiffSettings, async (): Promise<SettingsDiffReportDto> =>
    worker.call('diffSettings')
  )
  handle(
    IPC_CHANNELS.engineCaptureSettings,
    async (_event, request: CaptureRequest): Promise<SettingsCaptureReportDto> =>
      worker.call('captureSettings', request)
  )

  handle(IPC_CHANNELS.engineDiffServices, async (): Promise<ServicesDiffReportDto> =>
    worker.call('diffServices')
  )
  handle(
    IPC_CHANNELS.engineCaptureServices,
    async (_event, request: CaptureRequest): Promise<ServicesCaptureReportDto> =>
      worker.call('captureServices', request)
  )

  handle(IPC_CHANNELS.engineDiffScheduled, async (): Promise<ScheduledDiffReportDto> =>
    worker.call('diffScheduled')
  )
  handle(
    IPC_CHANNELS.engineCaptureScheduled,
    async (_event, request: CaptureRequest): Promise<ScheduledCaptureReportDto> =>
      worker.call('captureScheduled', request)
  )

  handle(IPC_CHANNELS.engineDiffTools, async (): Promise<ToolsDiffReportDto> =>
    worker.call('diffTools')
  )
  handle(
    IPC_CHANNELS.engineCaptureTools,
    async (_event, request: CaptureRequest): Promise<ToolsCaptureReportDto> =>
      worker.call('captureTools', request)
  )

  handle(IPC_CHANNELS.engineDiffRepos, async (): Promise<ReposDiffReportDto> =>
    worker.call('diffRepos')
  )
  handle(
    IPC_CHANNELS.engineCaptureRepos,
    async (_event, request: CaptureRequest): Promise<ReposCaptureReportDto> =>
      worker.call('captureRepos', request)
  )

  handle(IPC_CHANNELS.engineGetDoctorReport, async (): Promise<DoctorReportDto> =>
    worker.call('getDoctorReport')
  )
  handle(
    IPC_CHANNELS.engineIgnoreDoctorCheck,
    async (_event, request: IgnoreDoctorCheckRequest): Promise<DoctorReportDto> =>
      worker.call('ignoreDoctorCheck', request)
  )

  // P3 스케줄러의 마지막 결과는 main 쪽 메모리(index.ts 소유)에서 바로 읽는다
  // — 워커를 거칠 이유가 없다(엔진 실행이 아니라 이미 계산된 값 조회).
  handle(IPC_CHANNELS.engineGetLastDriftCheck, async (): Promise<DriftSummaryDto | null> => {
    return getLastDriftCheck()
  })

  handle(
    IPC_CHANNELS.engineCompleteOnboarding,
    async (_event, request: CompleteOnboardingRequest): Promise<CompleteOnboardingResponse> => {
      const response = await worker.call<CompleteOnboardingResponse>(
        'completeOnboarding',
        withElevationDeps(request)
      )
      refreshEngineContext()
      onConfigChanged()
      return response
    }
  )

  handle(
    IPC_CHANNELS.engineValidateManifestPath,
    async (_event, request: ValidateManifestPathRequest): Promise<ManifestPathCheckDto> =>
      worker.call('validateManifestPath', request)
  )

  handle(
    IPC_CHANNELS.engineCloneManifestRepo,
    async (_event, request: CloneManifestRepoRequest): Promise<CloneManifestRepoResponse> => {
      const response = await worker.call<CloneManifestRepoResponse>('cloneManifestRepo', request)
      if (response.ok) {
        refreshEngineContext()
        onConfigChanged()
      }
      return response
    }
  )

  handle(IPC_CHANNELS.engineGetSyncStatus, async (): Promise<SyncStatusDto> =>
    worker.call('getSyncStatus')
  )
  handle(IPC_CHANNELS.engineSyncNow, async (): Promise<SyncStatusDto> => worker.call('syncNow'))

  handle(
    IPC_CHANNELS.engineSetAutostart,
    async (_event, request: SetAutostartRequest): Promise<EngineStatus> => {
      const response = await worker.call<EngineStatus>('setAutostart', withElevationDeps(request))
      refreshEngineContext()
      return response
    }
  )

  handle(IPC_CHANNELS.engineGetConfig, async (): Promise<RigsyncConfigDto> =>
    worker.call('getConfig')
  )

  handle(
    IPC_CHANNELS.engineUpdateConfig,
    async (_event, request: UpdateConfigRequest): Promise<RigsyncConfigDto> => {
      const response = await worker.call<RigsyncConfigDto>(
        'updateConfig',
        withElevationDeps(request)
      )
      // R1: main이 캐시한 ctx를 즉시 무효화 + 스케줄러(간격)·트레이(다음 체크
      // 표시)까지 재해석되게 index.ts의 onConfigChanged를 그대로 재사용한다
      // (온보딩 완료 경로와 동일한 갱신 통로).
      refreshEngineContext()
      onConfigChanged()
      return response
    }
  )

  handle(IPC_CHANNELS.engineDetectDuplicates, async (): Promise<DuplicateWarningDto[]> =>
    worker.call('detectDuplicates')
  )
  handle(
    IPC_CHANNELS.engineDetectReclassifications,
    async (): Promise<ReclassificationEventDto[]> => worker.call('detectReclassifications')
  )

  handle(IPC_CHANNELS.engineListSyncItems, async (): Promise<SyncItemGroupDto[]> =>
    worker.call('listSyncItems')
  )
  handle(
    IPC_CHANNELS.engineToggleIgnore,
    async (_event, request: ToggleIgnoreRequest): Promise<SyncItemGroupDto[]> =>
      worker.call('toggleIgnore', request)
  )
  handle(
    IPC_CHANNELS.engineToggleIgnoreBulk,
    async (_event, request: ToggleIgnoreBulkRequest): Promise<SyncItemGroupDto[]> =>
      worker.call('toggleIgnoreBulk', request)
  )

  handle(
    IPC_CHANNELS.engineMoveEntryToHostLayer,
    async (_event, request: MoveEntryHostLayerRequest): Promise<SyncItemGroupDto[]> =>
      worker.call('moveEntryToHostLayer', request)
  )
  handle(
    IPC_CHANNELS.engineMoveEntryToCommonLayer,
    async (_event, request: MoveEntryHostLayerRequest): Promise<SyncItemGroupDto[]> =>
      worker.call('moveEntryToCommonLayer', request)
  )

  handle(IPC_CHANNELS.engineGetSelectionMode, async (): Promise<SelectionMode> =>
    worker.call('getSelectionMode')
  )
  handle(
    IPC_CHANNELS.engineSetSelectionMode,
    async (_event, request: SetSelectionModeRequest): Promise<SyncItemGroupDto[]> =>
      worker.call('setSelectionMode', request)
  )
  handle(
    IPC_CHANNELS.engineListEntrySubscribers,
    async (_event, request: ListEntrySubscribersRequest): Promise<string[]> =>
      worker.call('listEntrySubscribers', request)
  )
  handle(
    IPC_CHANNELS.engineToggleSubscribe,
    async (_event, request: ToggleSubscribeRequest): Promise<SyncItemGroupDto[]> =>
      worker.call('toggleSubscribe', request)
  )
  handle(
    IPC_CHANNELS.engineToggleSubscribeBulk,
    async (_event, request: ToggleSubscribeBulkRequest): Promise<SyncItemGroupDto[]> =>
      worker.call('toggleSubscribeBulk', request)
  )
  handle(
    IPC_CHANNELS.engineRegisterEntry,
    async (_event, request: RegisterEntryRequest): Promise<RegisterEntryResponse> =>
      worker.call('registerEntry', request)
  )
  handle(
    IPC_CHANNELS.engineUnregisterEntry,
    async (_event, request: UnregisterEntryRequest): Promise<RegisterEntryResponse> =>
      worker.call('unregisterEntry', request)
  )

  // engine:planEvent 진행 이벤트는 워커가 client 생성 시 등록한 onEvent
  // 콜백으로 직접 getMainWindow()?.webContents.send(...)까지 마친다 — 여기는
  // 요청/응답만 중계한다.
  handle(IPC_CHANNELS.engineApply, async (_event, request: ApplyRequest): Promise<ApplyResponse> =>
    worker.call('apply', request)
  )
  handle(IPC_CHANNELS.engineCancelApply, async (): Promise<void> => {
    await worker.call('cancelApply')
  })

  handle(
    IPC_CHANNELS.enginePlanUninstall,
    async (_event, request: PlanUninstallRequest): Promise<PlanUninstallResponse> =>
      worker.call('planUninstall', request)
  )
  handle(
    IPC_CHANNELS.engineRunUninstall,
    async (_event, request: RunUninstallRequest): Promise<RunUninstallResponse> =>
      worker.call('runUninstall', request)
  )
}
