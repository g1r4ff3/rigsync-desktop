/**
 * 엔진 워커 — Electron `utilityProcess`로 fork되는 별도 프로세스의 엔트리
 * 포인트. 성능 리팩토링 2단계(perf: 엔진 utilityProcess 분리)의 본체다.
 *
 * **왜**: main 프로세스의 28개 `ipcMain.handle`이 엔진(diff/capture/apply/
 * doctor 등)을 직접 실행했고, 엔진에는 동기 fs 트리 순회·`spawnSync` 기반
 * subprocess 호출이 많다(dotfiles 트리 미러링, secret scan, doctor 트리
 * 스캔, apt/snap/flatpak/dpkg 조회 등). 이게 전부 main의 이벤트 루프를
 * 그대로 블록해 창이 "응답 없음"이 됐다(1단계 계측으로 실측 확인:
 * `engine:getDoctorReport` 2.5초, `engine:diffPackages` 0.5초급).
 * 이 파일이 그 실행을 별도 프로세스로 옮겨 main의 이벤트 루프를 보호한다
 * — 엔진 자체의 총 소요시간은 안 줄지만(그건 3단계 최적화의 몫), 그동안
 * main은 여전히 응답한다.
 *
 * **이 파일의 내용은 옛 `src/main/ipc.ts`의 핸들러 바디를 그대로 옮긴
 * 것이다** (로직 변경 없음 — 실행 위치만 바뀜). `ipc.ts`는 이제 이
 * 프로세스에 요청을 보내고 응답을 기다리는 얇은 프록시로 남는다
 * (`engineWorkerClient.ts` 경유).
 *
 * **프로토콜**: `{id, method, args}` 요청 → `{id, ok, result|error}` 응답.
 * `engine:apply`/`engine:runUninstall`처럼 실행 중 진행률 이벤트가 필요한
 * 메서드는 응답과 별개로 `{type:'event', channel, payload}` 메시지를
 * 먼저(여러 번) 보낸다 — main의 client가 이를 구독해 그대로
 * `mainWindow.webContents.send`로 중계한다(기존 `engine:planEvent` 계약과
 * 100% 동일하게 렌더러에 보인다).
 *
 * **electron 모듈 제약**: utilityProcess 안에서는 `electron.app`/`BrowserWindow`
 * 등 main 전용 API가 없다 — `@electron-toolkit/utils`의 `is.dev`도
 * `electron.app.isPackaged`를 읽으므로 여기서 import하면 던진다. `isDev`·
 * `execPath`처럼 electron 전용 파생값이 필요한 메서드(`completeOnboarding`/
 * `setAutostart`/`updateConfig`)는 main이 매 요청 payload에 실어 보낸다.
 */
import { captureAppimage } from '../engine/capabilities/appimage/capture'
import { diffAppimage } from '../engine/capabilities/appimage/diff'
import { planAppimage } from '../engine/capabilities/appimage/plan'
import { captureBinaries } from '../engine/capabilities/binaries/capture'
import { diffBinaries } from '../engine/capabilities/binaries/diff'
import { planBinaries } from '../engine/capabilities/binaries/plan'
import { captureDotfiles } from '../engine/capabilities/dotfiles/capture'
import { diffDotfiles } from '../engine/capabilities/dotfiles/diff'
import { planDotfiles } from '../engine/capabilities/dotfiles/plan'
import { captureFonts } from '../engine/capabilities/fonts/capture'
import { diffFonts } from '../engine/capabilities/fonts/diff'
import { planFonts } from '../engine/capabilities/fonts/plan'
import { capturePackages } from '../engine/capabilities/packages/capture'
import { diffPackages } from '../engine/capabilities/packages/diff'
import { planPackages } from '../engine/capabilities/packages/plan'
import { captureRepos } from '../engine/capabilities/repos/capture'
import { diffRepos } from '../engine/capabilities/repos/diff'
import { planRepos } from '../engine/capabilities/repos/plan'
import { captureScheduled } from '../engine/capabilities/scheduled/capture'
import { diffScheduled } from '../engine/capabilities/scheduled/diff'
import { planScheduled } from '../engine/capabilities/scheduled/plan'
import { captureServices } from '../engine/capabilities/services/capture'
import { diffServices } from '../engine/capabilities/services/diff'
import { planServices } from '../engine/capabilities/services/plan'
import { captureSettings } from '../engine/capabilities/settings/capture'
import { diffSettings } from '../engine/capabilities/settings/diff'
import { planSettings } from '../engine/capabilities/settings/plan'
import { captureTools } from '../engine/capabilities/tools/capture'
import { diffTools } from '../engine/capabilities/tools/diff'
import { planTools } from '../engine/capabilities/tools/plan'
import {
  DEFAULT_DRIFT_CHECK_INTERVAL_HOURS,
  resolveContext,
  writeConfigFile,
  type RigsyncContext
} from '../engine/context'
import { guardedSetAutostart } from './autostartGuard'
import { orderCombinedPlan } from './planOrder'
import {
  autoSyncAfterWrite,
  getLastSyncStatus,
  sweepLiveEditsBeforeWrite,
  triggerSync
} from './gitSync'
import { runDriftCheck } from './driftCheck'
import { completeOnboarding, expandTilde } from './onboarding'
import { buildDoctorReport } from '../engine/doctor/report'
import { ignoreDoctorCheck } from '../engine/doctor/toggle'
import { ApplyRunner, buildSudoScriptPreview } from '../engine/elevation'
import { detectDuplicates } from '../engine/duplicates'
import { checkExistingManifestPath } from '../engine/manifestPathCheck'
import type { PlanAction } from '../engine/plan'
import { cloneManifestRepo, cloneErrorGuidance } from '../engine/transport'
import { planUninstall, type UninstallProviders } from '../engine/uninstall'
import {
  linuxAssetResolver,
  linuxBinariesSystemProvider,
  linuxBinaryAssetResolver,
  linuxBinaryDownloader,
  linuxBinaryZipExtractor,
  linuxCronProvider,
  linuxDconfProvider,
  linuxDoctorSystemProvider,
  linuxDownloader,
  linuxElevationExec,
  linuxFontAssetResolver,
  linuxFontDownloader,
  linuxFontsSystemProvider,
  linuxGearLeverProvider,
  linuxGitProvider,
  linuxGitTransportProvider,
  linuxNvidiaCheckProvider,
  linuxPackageProviders,
  linuxSystemdUserProvider,
  linuxTarExtractor,
  linuxToolsProvider,
  linuxZipExtractor,
  linuxAppimageSystemCheck
} from '../engine/providers/linux'
import { detectReclassifications } from '../engine/reclassification'
import { type MethodKind, RequestScheduler } from './requestScheduler'
import { moveEntryToCommonLayer, moveEntryToHostLayer } from '../engine/hostLayerMove'
import {
  listSyncItemGroups,
  toggleAptDistroSyncedBulk,
  toggleSyncItemIgnore,
  toggleSyncItemIgnoreBulk,
  withSyncItemState
} from '../engine/syncItems'
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
  type DotfilesCaptureReport,
  type DotfilesDiffReport,
  type DuplicateWarningDto,
  type EngineStatus,
  type FontsCaptureReportDto,
  type FontsDiffReportDto,
  type IgnoreDoctorCheckRequest,
  type ManifestPathCheckDto,
  type MoveEntryHostLayerRequest,
  type PackagesCaptureReport,
  type PackagesDiffReport,
  type PlanActionResultDto,
  type PlanEvent,
  type PlanSummaryDto,
  type PlanUninstallRequest,
  type PlanUninstallResponse,
  type ReclassificationEventDto,
  type ReposCaptureReportDto,
  type ReposDiffReportDto,
  type RigsyncConfigDto,
  type RunUninstallRequest,
  type RunUninstallResponse,
  type ScheduledCaptureReportDto,
  type ScheduledDiffReportDto,
  type ServicesCaptureReportDto,
  type ServicesDiffReportDto,
  type SetAutostartRequest,
  type SettingsCaptureReportDto,
  type SettingsDiffReportDto,
  type SyncItemGroupDto,
  type SyncStatusDto,
  type ToggleIgnoreBulkRequest,
  type ToggleIgnoreRequest,
  type ToolsCaptureReportDto,
  type ToolsDiffReportDto,
  type UpdateConfigRequest,
  type ValidateManifestPathRequest
} from '../shared/ipc'
import type { DriftSummary } from '../engine/drift'

// packages/appimage capability의 provider 묶음 -- v1은 Linux 고정 (FORWARD.md
// §3: "v1은 Linux provider만"). darwin/win32가 생기면 process.platform으로
// 분기한다.
const providers = linuxPackageProviders
const gearLeverProvider = linuxGearLeverProvider
const dconfProvider = linuxDconfProvider
const systemdUserProvider = linuxSystemdUserProvider
const cronProvider = linuxCronProvider
const toolsProvider = linuxToolsProvider
const gitProvider = linuxGitProvider
const doctorSystemProvider = linuxDoctorSystemProvider
const nvidiaCheckProvider = linuxNvidiaCheckProvider
const gitTransportProvider = linuxGitTransportProvider
// 항목 삭제(uninstall) 엔진이 요구하는 provider 3종 — apt/flatpak는 이미 위
// `providers`(packages 캡처/diff와 동일 인스턴스)에서, fontsSystem은 fonts
// capability의 provider를 그대로 재사용한다(새 provider를 만들지 않는다).
const uninstallProviders: UninstallProviders = {
  apt: providers.apt,
  flatpak: providers.flatpak,
  fontsSystem: linuxFontsSystemProvider
}

// config.toml은 온보딩 위저드(P4) 전에는 없는 게 정상이라 dev 기본값으로
// 뜬다 — 이 워커 프로세스의 생애주기 동안 한 번만 해석한다(옛 ipc.ts의
// module-level 캐시와 동일한 패턴 — 그저 사는 프로세스가 바뀌었을 뿐).
let resolved = resolveContext()

function getContext(): RigsyncContext {
  return resolved.ctx
}

function refreshContext(): void {
  resolved = resolveContext()
}

function runTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * manifest 쓰기 경로(capture·ignore 토글) 앞뒤에 P4(F4/D3-a) 라이브 편집 스윕 +
 * 자동 commit+push를 붙인다 — 옛 ipc.ts `withAutoSync`와 동일 로직.
 */
async function withAutoSync<T>(dryRun: boolean, run: () => Promise<T>): Promise<T> {
  if (!dryRun) await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
  const result = await run()
  if (!dryRun) autoSyncAfterWrite(getContext(), gitTransportProvider)
  return result
}

async function buildCombinedPlan(ctx: RigsyncContext, runTs: string): Promise<PlanAction[]> {
  const [
    dotfilesDiff,
    packagesDiff,
    appimageDiff,
    fontsDiff,
    binariesDiff,
    settingsDiff,
    servicesDiff,
    scheduledDiff,
    toolsDiff,
    reposDiff
  ] = await Promise.all([
    diffDotfiles(ctx),
    diffPackages(ctx, providers),
    diffAppimage(ctx, gearLeverProvider),
    diffFonts(ctx),
    diffBinaries(ctx, linuxBinariesSystemProvider),
    diffSettings(ctx, dconfProvider),
    diffServices(ctx, systemdUserProvider),
    diffScheduled(ctx, cronProvider),
    diffTools(ctx, toolsProvider),
    diffRepos(ctx)
  ])
  // planPackages는 perf 3라운드로 async가 됐다(내부 apt plan이 provider
  // 조회를 한다) -- 나머지 plan*은 여전히 동기(액션의 run() 클로저 안에서만
  // provider를 부른다). 새 병렬화를 발명하지 않고 순차 await만 앞에 둔다.
  const packagesPlan = await planPackages(ctx, providers, packagesDiff, runTs)
  return orderCombinedPlan({
    repos: planRepos(ctx, gitProvider, reposDiff),
    dotfiles: planDotfiles(ctx, dotfilesDiff, runTs),
    packages: packagesPlan,
    appimage: planAppimage(
      ctx,
      gearLeverProvider,
      linuxAssetResolver,
      linuxDownloader,
      appimageDiff
    ),
    fonts: planFonts(
      ctx,
      fontsDiff,
      linuxFontAssetResolver,
      linuxFontDownloader,
      linuxZipExtractor,
      linuxFontsSystemProvider,
      runTs
    ),
    binaries: planBinaries(
      ctx,
      binariesDiff,
      linuxBinaryAssetResolver,
      linuxBinaryDownloader,
      linuxBinaryZipExtractor,
      linuxTarExtractor,
      runTs
    ),
    settings: planSettings(ctx, dconfProvider, settingsDiff),
    services: planServices(ctx, systemdUserProvider, servicesDiff, runTs),
    scheduled: planScheduled(ctx, cronProvider, scheduledDiff, runTs),
    tools: planTools(ctx, toolsProvider, toolsDiff)
  })
}

async function doctorReport(): Promise<DoctorReportDto> {
  return buildDoctorReport(
    getContext(),
    doctorSystemProvider,
    gearLeverProvider,
    linuxAppimageSystemCheck,
    linuxFontsSystemProvider,
    nvidiaCheckProvider,
    gitTransportProvider,
    providers.apt,
    { configConfigured: !resolved.firstRun }
  )
}

// 현재 진행 중인 apply의 ApplyRunner -- cancelApply가 신호를 보낼 대상.
// invoke 하나가 한 번에 하나씩만 진행된다는 전제(동시에 두 Apply 클릭을
// 허용하지 않는 건 UI 쪽 책임)로 단순하게 모듈 변수 하나로 둔다.
let currentApplyRunner: ApplyRunner | null = null

// R6 R1: listSyncItemGroups()의 순수 결과(engine 테스트 계약)는 그대로 두고,
// 이 경계에서만 withSyncItemState()로 감싸 클라이언트 DTO에 4상태를 싣는다.
async function listSyncItemGroupsForClient(): Promise<SyncItemGroupDto[]> {
  const groups = await listSyncItemGroups(
    getContext(),
    providers,
    gearLeverProvider,
    toolsProvider,
    gitProvider
  )
  return [...withSyncItemState(groups)]
}

/** electron 전용 파생값(main만 안다) — completeOnboarding/setAutostart/updateConfig가 요청마다 받는다. */
interface ElevationDeps {
  readonly execPath: string
  readonly isDev: boolean
}

function sendPlanEvent(event: PlanEvent): void {
  postEvent(IPC_CHANNELS.enginePlanEvent, event)
}

async function runApplyLike(
  plan: readonly PlanAction[],
  confirm: boolean
): Promise<{ results: PlanActionResultDto[]; summary: PlanSummaryDto }> {
  const runner = new ApplyRunner()
  currentApplyRunner = runner
  runner.on('action_start', (payload) => sendPlanEvent({ type: 'action_start', ...payload }))
  runner.on('action_done', (payload) => sendPlanEvent({ type: 'action_done', ...payload }))
  let summary: PlanSummaryDto = { ok: 0, failed: 0, skipped: 0, cancelled: 0 }
  runner.on('summary', (payload) => {
    summary = payload
    sendPlanEvent({ type: 'summary', summary: payload })
  })
  try {
    const results = await runner.run(plan, { confirm, elevationExec: linuxElevationExec })
    return { results, summary }
  } finally {
    currentApplyRunner = null
  }
}

type Handler = (args: unknown) => Promise<unknown>

const handlers: Record<string, Handler> = {
  getStatus: async (): Promise<EngineStatus> => {
    const { ctx, firstRun } = resolved
    return {
      machineId: ctx.machineId,
      role: ctx.role,
      manifestDir: ctx.manifestDir,
      firstRun,
      autostartEnabled: ctx.autostartEnabled
    }
  },

  diffDotfiles: async (): Promise<DotfilesDiffReport> => diffDotfiles(getContext()),
  captureDotfiles: async (args): Promise<DotfilesCaptureReport> => {
    const request = args as CaptureDotfilesRequest
    return withAutoSync(request.dryRun, () =>
      captureDotfiles(getContext(), { dryRun: request.dryRun })
    )
  },

  diffPackages: async (): Promise<PackagesDiffReport> => diffPackages(getContext(), providers),
  capturePackages: async (args): Promise<PackagesCaptureReport> => {
    const request = args as CapturePackagesRequest
    return withAutoSync(request.dryRun, () =>
      capturePackages(getContext(), providers, { dryRun: request.dryRun })
    )
  },

  diffAppimage: async (): Promise<AppimageDiffReportDto> =>
    diffAppimage(getContext(), gearLeverProvider),
  captureAppimage: async (args): Promise<AppimageCaptureReportDto> => {
    const request = args as CaptureAppimageRequest
    return withAutoSync(request.dryRun, () =>
      captureAppimage(getContext(), gearLeverProvider, { dryRun: request.dryRun })
    )
  },

  diffFonts: async (): Promise<FontsDiffReportDto> => diffFonts(getContext()),
  captureFonts: async (args): Promise<FontsCaptureReportDto> => {
    const request = args as CaptureFontsRequest
    return withAutoSync(request.dryRun, () =>
      captureFonts(getContext(), { dryRun: request.dryRun })
    )
  },

  diffBinaries: async (): Promise<BinariesDiffReportDto> =>
    diffBinaries(getContext(), linuxBinariesSystemProvider),
  captureBinaries: async (args): Promise<BinariesCaptureReportDto> => {
    const request = args as CaptureBinariesRequest
    return withAutoSync(request.dryRun, () =>
      captureBinaries(getContext(), { dryRun: request.dryRun })
    )
  },

  diffSettings: async (): Promise<SettingsDiffReportDto> =>
    diffSettings(getContext(), dconfProvider),
  captureSettings: async (args): Promise<SettingsCaptureReportDto> => {
    const request = args as CaptureRequest
    return withAutoSync(request.dryRun, () =>
      captureSettings(getContext(), dconfProvider, { dryRun: request.dryRun })
    )
  },

  diffServices: async (): Promise<ServicesDiffReportDto> =>
    diffServices(getContext(), systemdUserProvider),
  captureServices: async (args): Promise<ServicesCaptureReportDto> => {
    const request = args as CaptureRequest
    return withAutoSync(request.dryRun, () =>
      captureServices(getContext(), systemdUserProvider, { dryRun: request.dryRun })
    )
  },

  diffScheduled: async (): Promise<ScheduledDiffReportDto> =>
    diffScheduled(getContext(), cronProvider),
  captureScheduled: async (args): Promise<ScheduledCaptureReportDto> => {
    const request = args as CaptureRequest
    return withAutoSync(request.dryRun, () =>
      captureScheduled(getContext(), cronProvider, { dryRun: request.dryRun })
    )
  },

  diffTools: async (): Promise<ToolsDiffReportDto> => diffTools(getContext(), toolsProvider),
  captureTools: async (args): Promise<ToolsCaptureReportDto> => {
    const request = args as CaptureRequest
    return withAutoSync(request.dryRun, () =>
      captureTools(getContext(), toolsProvider, { dryRun: request.dryRun })
    )
  },

  diffRepos: async (): Promise<ReposDiffReportDto> => diffRepos(getContext()),
  captureRepos: async (args): Promise<ReposCaptureReportDto> => {
    const request = args as CaptureRequest
    return withAutoSync(request.dryRun, () =>
      captureRepos(getContext(), gitProvider, { dryRun: request.dryRun })
    )
  },

  getDoctorReport: async (): Promise<DoctorReportDto> => doctorReport(),
  ignoreDoctorCheck: async (args): Promise<DoctorReportDto> => {
    const request = args as IgnoreDoctorCheckRequest
    await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
    ignoreDoctorCheck(getContext(), request.name, request.ignored)
    autoSyncAfterWrite(getContext(), gitTransportProvider)
    return doctorReport()
  },

  runDriftCheck: async (): Promise<DriftSummary> => runDriftCheck(getContext()),

  completeOnboarding: async (args): Promise<CompleteOnboardingResponse> => {
    const request = args as CompleteOnboardingRequest & ElevationDeps
    await completeOnboarding(request, {
      homeDir: getContext().homeDir,
      execPath: request.execPath,
      isDev: request.isDev,
      gitTransportProvider
    })
    refreshContext()
    const { ctx, firstRun } = resolved
    return {
      status: {
        machineId: ctx.machineId,
        role: ctx.role,
        manifestDir: ctx.manifestDir,
        firstRun,
        autostartEnabled: ctx.autostartEnabled
      }
    }
  },

  validateManifestPath: async (args): Promise<ManifestPathCheckDto> => {
    const request = args as ValidateManifestPathRequest
    const targetDir = expandTilde(request.manifestDir, getContext().homeDir)
    return checkExistingManifestPath(targetDir, gitTransportProvider)
  },

  cloneManifestRepo: async (args): Promise<CloneManifestRepoResponse> => {
    const request = args as CloneManifestRepoRequest
    const ctx = getContext()
    const targetDir = expandTilde(request.manifestDir, ctx.homeDir)
    const result = await cloneManifestRepo(request.repoUrl.trim(), targetDir, gitTransportProvider)
    if (!result.ok) {
      return { ok: false, error: cloneErrorGuidance(result.error) }
    }
    writeConfigFile(ctx.homeDir, {
      machineId: ctx.machineId,
      role: ctx.role,
      manifestDir: targetDir,
      ...(ctx.profile ? { profile: ctx.profile } : {}),
      autostartEnabled: ctx.autostartEnabled,
      driftCheckIntervalHours: ctx.settings.driftCheckIntervalHours
    })
    refreshContext()
    const updated = resolved.ctx
    return {
      ok: true,
      config: {
        machineId: updated.machineId,
        role: updated.role,
        manifestDir: updated.manifestDir,
        ...(updated.profile ? { profile: updated.profile } : {}),
        autostartEnabled: updated.autostartEnabled,
        driftCheckIntervalHours:
          updated.settings.driftCheckIntervalHours ?? DEFAULT_DRIFT_CHECK_INTERVAL_HOURS
      }
    }
  },

  getSyncStatus: async (): Promise<SyncStatusDto> =>
    getLastSyncStatus(getContext(), gitTransportProvider),
  syncNow: async (): Promise<SyncStatusDto> => triggerSync(getContext(), gitTransportProvider),

  setAutostart: async (args): Promise<EngineStatus> => {
    const request = args as SetAutostartRequest & ElevationDeps
    guardedSetAutostart(getContext().homeDir, request.enabled, request.execPath, request.isDev)
    const ctx = getContext()
    writeConfigFile(ctx.homeDir, {
      machineId: ctx.machineId,
      role: ctx.role,
      manifestDir: ctx.manifestDir,
      autostartEnabled: request.enabled,
      ...(ctx.profile ? { profile: ctx.profile } : {})
    })
    refreshContext()
    const { ctx: newCtx, firstRun } = resolved
    return {
      machineId: newCtx.machineId,
      role: newCtx.role,
      manifestDir: newCtx.manifestDir,
      firstRun,
      autostartEnabled: newCtx.autostartEnabled
    }
  },

  getConfig: async (): Promise<RigsyncConfigDto> => {
    const ctx = getContext()
    return {
      machineId: ctx.machineId,
      role: ctx.role,
      manifestDir: ctx.manifestDir,
      ...(ctx.profile ? { profile: ctx.profile } : {}),
      autostartEnabled: ctx.autostartEnabled,
      driftCheckIntervalHours:
        ctx.settings.driftCheckIntervalHours ?? DEFAULT_DRIFT_CHECK_INTERVAL_HOURS
    }
  },

  updateConfig: async (args): Promise<RigsyncConfigDto> => {
    const request = args as UpdateConfigRequest & ElevationDeps
    const homeDir = getContext().homeDir
    const manifestDir = expandTilde(request.manifestDir, homeDir)
    writeConfigFile(homeDir, {
      machineId: request.machineId,
      role: request.role,
      manifestDir,
      autostartEnabled: request.autostartEnabled,
      driftCheckIntervalHours: request.driftCheckIntervalHours,
      ...(request.profile ? { profile: request.profile } : {})
    })
    guardedSetAutostart(homeDir, request.autostartEnabled, request.execPath, request.isDev)
    refreshContext()
    const ctx = getContext()
    return {
      machineId: ctx.machineId,
      role: ctx.role,
      manifestDir: ctx.manifestDir,
      ...(ctx.profile ? { profile: ctx.profile } : {}),
      autostartEnabled: ctx.autostartEnabled,
      driftCheckIntervalHours:
        ctx.settings.driftCheckIntervalHours ?? DEFAULT_DRIFT_CHECK_INTERVAL_HOURS
    }
  },

  detectDuplicates: async (): Promise<DuplicateWarningDto[]> =>
    detectDuplicates(getContext(), providers, gearLeverProvider),

  detectReclassifications: async (): Promise<ReclassificationEventDto[]> => {
    const ctx = getContext()
    const [packagesDiff, appimageDiff] = await Promise.all([
      diffPackages(ctx, providers),
      diffAppimage(ctx, gearLeverProvider)
    ])
    return detectReclassifications(providers, gearLeverProvider, {
      apt: packagesDiff.apt.toInstall,
      flatpak: packagesDiff.flatpak.toInstall.map((a) => a.application),
      appimage: appimageDiff.toInstall
    })
  },

  listSyncItems: async (): Promise<SyncItemGroupDto[]> => listSyncItemGroupsForClient(),

  toggleIgnore: async (args): Promise<SyncItemGroupDto[]> => {
    const request = args as ToggleIgnoreRequest
    await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
    if (request.subgroup === 'apt-distro') {
      toggleAptDistroSyncedBulk(getContext(), [request.key], !request.ignored)
    } else {
      toggleSyncItemIgnore(getContext(), request.capability, request.key, request.ignored)
    }
    autoSyncAfterWrite(getContext(), gitTransportProvider)
    return listSyncItemGroupsForClient()
  },

  toggleIgnoreBulk: async (args): Promise<SyncItemGroupDto[]> => {
    const request = args as ToggleIgnoreBulkRequest
    await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
    if (request.subgroup === 'apt-distro') {
      toggleAptDistroSyncedBulk(getContext(), request.keys, !request.ignored)
    } else {
      toggleSyncItemIgnoreBulk(getContext(), request.capability, request.keys, request.ignored)
    }
    autoSyncAfterWrite(getContext(), gitTransportProvider)
    return listSyncItemGroupsForClient()
  },

  moveEntryToHostLayer: async (args): Promise<SyncItemGroupDto[]> => {
    const request = args as MoveEntryHostLayerRequest
    await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
    moveEntryToHostLayer(getContext(), request.capability, request.key)
    autoSyncAfterWrite(getContext(), gitTransportProvider)
    return listSyncItemGroupsForClient()
  },

  moveEntryToCommonLayer: async (args): Promise<SyncItemGroupDto[]> => {
    const request = args as MoveEntryHostLayerRequest
    await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
    moveEntryToCommonLayer(getContext(), request.capability, request.key)
    autoSyncAfterWrite(getContext(), gitTransportProvider)
    return listSyncItemGroupsForClient()
  },

  apply: async (args): Promise<ApplyResponse> => {
    const request = args as ApplyRequest
    const ctx = getContext()
    const plan = await buildCombinedPlan(ctx, runTimestamp())
    const { results, summary } = await runApplyLike(plan, request.confirm)
    // 확인 다이얼로그(dry-run 프리뷰)에서만 스크립트 전문을 보여준다 —
    // 실행 후 응답엔 필요 없다(불변식 ⑥은 "실행 전 노출"이 핵심).
    const sudoScriptPreview = request.confirm
      ? undefined
      : (buildSudoScriptPreview(plan) ?? undefined)
    return { results, summary, sudoScriptPreview }
  },

  cancelApply: async (): Promise<void> => {
    currentApplyRunner?.cancel()
  },

  planUninstall: async (args): Promise<PlanUninstallResponse> => {
    const request = args as PlanUninstallRequest
    const ctx = getContext()
    const plan = await planUninstall(ctx, uninstallProviders, request.items, runTimestamp())
    const actions: PlanActionResultDto[] = plan.actions.map((action) => ({
      capability: action.capability,
      summary: action.summary,
      commands: action.commands,
      status: 'planned'
    }))
    const sudoScriptPreview = buildSudoScriptPreview(plan.actions) ?? undefined
    return {
      actions,
      excluded: plan.excluded,
      ...(plan.aptDependencies ? { aptDependencies: plan.aptDependencies } : {}),
      ...(sudoScriptPreview ? { sudoScriptPreview } : {})
    }
  },

  runUninstall: async (args): Promise<RunUninstallResponse> => {
    const request = args as RunUninstallRequest
    const ctx = getContext()
    const plan = await planUninstall(ctx, uninstallProviders, request.items, runTimestamp())
    return runApplyLike(plan.actions, true)
  }
}

// ---------------------------------------------------------------------------
// 동시성 규율 (v0.1.17 성능 2라운드 2단계) — requestScheduler.ts 참조.
// ---------------------------------------------------------------------------

/**
 * 읽기 전용(diff·조회) — 서로 동시 실행 허용 + in-flight 병합 대상. 여기 없는
 * 메서드는 `WRITE_METHODS`나 `UNLOCKED_METHODS`에 있지 않는 한 기본이 'write'다
 * (새 IPC 메서드를 추가하면서 이 목록 갱신을 까먹었을 때 "배타적으로 취급"이
 * "동시 실행 허용"보다 훨씬 안전한 fail-closed 기본값이라 그렇게 뒀다).
 */
const READ_METHODS = new Set<string>([
  'getStatus',
  'diffDotfiles',
  'diffPackages',
  'diffAppimage',
  'diffFonts',
  'diffBinaries',
  'diffSettings',
  'diffServices',
  'diffScheduled',
  'diffTools',
  'diffRepos',
  'getDoctorReport',
  'runDriftCheck',
  'validateManifestPath',
  'getSyncStatus',
  'getConfig',
  'detectDuplicates',
  'detectReclassifications',
  'listSyncItems',
  'planUninstall'
])

/**
 * 락을 아예 건너뛰는 메서드 — `cancelApply`는 진행 중인 `apply`(write 락 보유)를
 * 중단시키는 신호라, 그 자신이 write 락 뒤에 줄서면 apply가 끝날 때까지
 * 영원히 실행되지 못해 취소가 불가능해진다.
 */
const UNLOCKED_METHODS = new Set<string>(['cancelApply'])

function classifyMethod(method: string): MethodKind {
  if (UNLOCKED_METHODS.has(method)) return 'unlocked'
  if (READ_METHODS.has(method)) return 'read'
  return 'write'
}

// 병합(coalescing) 대상은 읽기 전용으로 한정한다 — 변조 연산은 멱등이
// 아닐 수 있어(예: 두 번째 capture가 첫 번째 이후 상태를 다시 잡아야 함)
// 자동 병합하면 위험하다. 배타 락이 이미 순서를 보장하므로 각자 새로 실행된다.
const scheduler = new RequestScheduler({
  classify: classifyMethod,
  coalesce: (method) => READ_METHODS.has(method)
})

// ---------------------------------------------------------------------------
// 메시지 루프
// ---------------------------------------------------------------------------

interface WorkerRequest {
  readonly id: number
  readonly method: string
  readonly args: unknown
}

function postEvent(channel: string, payload: unknown): void {
  process.parentPort.postMessage({ type: 'event', channel, payload })
}

function serializeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack }
  return { message: String(err) }
}

async function dispatch(request: WorkerRequest): Promise<void> {
  const handler = handlers[request.method]
  if (!handler) {
    process.parentPort.postMessage({
      id: request.id,
      ok: false,
      error: { message: `엔진 워커: 알 수 없는 method "${request.method}"` }
    })
    return
  }
  try {
    const result = await scheduler.run(request.method, request.args, () => handler(request.args))
    process.parentPort.postMessage({ id: request.id, ok: true, result: result ?? null })
  } catch (err) {
    process.parentPort.postMessage({ id: request.id, ok: false, error: serializeError(err) })
  }
}

process.parentPort.on('message', (e) => {
  void dispatch(e.data as WorkerRequest)
})

process.parentPort.postMessage({ type: 'ready' })
