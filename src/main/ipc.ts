/**
 * engine IPC 핸들러 등록 — main 프로세스에서 딱 한 번 호출한다(`app.whenReady`
 * 안에서). `ipcMain.handle`은 같은 채널에 두 번 등록하면 던지므로, 창이
 * (macOS activate로) 다시 만들어져도 여기는 재실행되지 않는다 — 창 참조는
 * `getMainWindow` 콜백으로 늦게 묶는다(P1 확정 결정 ⑤·⑥).
 *
 * P2a: packages capability(apt/snap/flatpak)가 추가되면서 `engine:apply`는
 * dotfiles + packages 두 capability의 plan을 합쳐 실행한다.
 * P2b: 그 실행은 이제 `ApplyRunner`(src/engine/elevation)가 맡는다 — 비특권
 * 액션은 기존 PlanExecutor로, 특권 액션(apt/snap install 등)은 pkexec 스크립트
 * 하나로 묶어 실행한다. main은 정말 "배선만" 한다(결정 ① — 스크립트 생성·파싱은
 * 순수 엔진 코드, pkexec spawn은 `linuxElevationExec`).
 * P2c: T3 appimage(Gear Lever)도 diff/capture/apply에 합류. INV-1 중복 검출과
 * 정책 §5 재분류 감지는 조회 전용 엔드포인트로 노출한다.
 * P2d: settings(dconf)/services(systemd --user)/scheduled(cron)/tools(nvm)/
 * repos(git)가 합류해 구 CLI와 레이어 패리티가 된다. doctor는 새 조회 전용
 * 엔드포인트(checks 레이어 + 기본 진단 + appimage preflight 통합).
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
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
  type DriftSummaryDto,
  type DotfilesCaptureReport,
  type DotfilesDiffReport,
  type DuplicateWarningDto,
  type EngineStatus,
  type FontsCaptureReportDto,
  type FontsDiffReportDto,
  type IgnoreDoctorCheckRequest,
  type ManifestPathCheckDto,
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
// 뜬다 — 앱 프로세스 생애주기 동안 한 번만 해석한다(전역 상태처럼 보이지만
// 이건 main 쪽 캐시일 뿐, 엔진 함수들은 여전히 이 ctx를 인자로 받는다).
let resolved = resolveContext()

function getContext(): RigsyncContext {
  return resolved.ctx
}

/**
 * P3: index.ts(스케줄러/트레이 배선)가 이 ipc.ts와 같은 캐시된 ctx를 쓰기
 * 위한 통로 — 별도로 `resolveContext()`를 다시 호출하면 온보딩(P4) 후
 * `refreshEngineContext()`가 갱신한 값과 어긋날 수 있다.
 */
export function getEngineContext(): RigsyncContext {
  return resolved.ctx
}

function runTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * manifest 쓰기 경로(capture·ignore 토글) 앞뒤에 P4(F4/D3-a) 라이브 편집 스윕 +
 * 자동 commit+push를 붙인다(코디네이터 지시 "reference: manifest 변경 후 자동
 * commit+push"). dry-run이면 아무것도 쓰지 않았으니 스윕도 동기화도 트리거하지
 * 않는다.
 *
 * 쓰기 **전** `sweepLiveEditsBeforeWrite`를 await하는 이유: 이 시점에 작업
 * 트리가 이미 dirty했다면(사용자가 심링크 너머로 직접 편집한 라이브 편집)
 * 그 dirt를 이번 쓰기 자신의 diff와 섞이기 전에 별도 `live-edit: …` 커밋으로
 * 먼저 분리해야, 쓰기 뒤 `autoSyncAfterWrite`가 만드는 "capture: …" 커밋이
 * 이번 쓰기만 담는다(F4 해소 -- run() 시작 전에 완료돼야 하므로 fire-and-forget
 * 불가, 반드시 await). 쓰기 **뒤**의 `autoSyncAfterWrite`는 기존 그대로
 * fire-and-forget이라 이 핸들러의 응답을 블로킹하지 않는다 -- push 실패는
 * engine:getSyncStatus로 표면화된다.
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
  return orderCombinedPlan({
    repos: planRepos(ctx, gitProvider, reposDiff),
    dotfiles: planDotfiles(ctx, dotfilesDiff, runTs),
    packages: planPackages(ctx, providers, packagesDiff, runTs),
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

// 현재 진행 중인 apply의 ApplyRunner -- engine:cancelApply가 신호를 보낼
// 대상. invoke 하나가 한 번에 하나씩만 진행된다는 전제(동시에 두 Apply
// 클릭을 허용하지 않는 건 UI 쪽 책임)로 단순하게 모듈 변수 하나로 둔다.
let currentApplyRunner: ApplyRunner | null = null

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

  ipcMain.handle(IPC_CHANNELS.engineGetStatus, async (): Promise<EngineStatus> => {
    const { ctx, firstRun } = resolved
    return {
      machineId: ctx.machineId,
      role: ctx.role,
      manifestDir: ctx.manifestDir,
      firstRun,
      autostartEnabled: ctx.autostartEnabled
    }
  })

  ipcMain.handle(IPC_CHANNELS.engineDiffDotfiles, async (): Promise<DotfilesDiffReport> => {
    return diffDotfiles(getContext())
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureDotfiles,
    async (_event, request: CaptureDotfilesRequest): Promise<DotfilesCaptureReport> => {
      return withAutoSync(request.dryRun, () =>
        captureDotfiles(getContext(), { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffPackages, async (): Promise<PackagesDiffReport> => {
    return diffPackages(getContext(), providers)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCapturePackages,
    async (_event, request: CapturePackagesRequest): Promise<PackagesCaptureReport> => {
      return withAutoSync(request.dryRun, () =>
        capturePackages(getContext(), providers, { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffAppimage, async (): Promise<AppimageDiffReportDto> => {
    return diffAppimage(getContext(), gearLeverProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureAppimage,
    async (_event, request: CaptureAppimageRequest): Promise<AppimageCaptureReportDto> => {
      return withAutoSync(request.dryRun, () =>
        captureAppimage(getContext(), gearLeverProvider, { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffFonts, async (): Promise<FontsDiffReportDto> => {
    return diffFonts(getContext())
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureFonts,
    async (_event, request: CaptureFontsRequest): Promise<FontsCaptureReportDto> => {
      return withAutoSync(request.dryRun, () =>
        captureFonts(getContext(), { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffBinaries, async (): Promise<BinariesDiffReportDto> => {
    return diffBinaries(getContext(), linuxBinariesSystemProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureBinaries,
    async (_event, request: CaptureBinariesRequest): Promise<BinariesCaptureReportDto> => {
      return withAutoSync(request.dryRun, () =>
        captureBinaries(getContext(), { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffSettings, async (): Promise<SettingsDiffReportDto> => {
    return diffSettings(getContext(), dconfProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureSettings,
    async (_event, request: CaptureRequest): Promise<SettingsCaptureReportDto> => {
      return withAutoSync(request.dryRun, () =>
        captureSettings(getContext(), dconfProvider, { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffServices, async (): Promise<ServicesDiffReportDto> => {
    return diffServices(getContext(), systemdUserProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureServices,
    async (_event, request: CaptureRequest): Promise<ServicesCaptureReportDto> => {
      return withAutoSync(request.dryRun, () =>
        captureServices(getContext(), systemdUserProvider, { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffScheduled, async (): Promise<ScheduledDiffReportDto> => {
    return diffScheduled(getContext(), cronProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureScheduled,
    async (_event, request: CaptureRequest): Promise<ScheduledCaptureReportDto> => {
      return withAutoSync(request.dryRun, () =>
        captureScheduled(getContext(), cronProvider, { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffTools, async (): Promise<ToolsDiffReportDto> => {
    return diffTools(getContext(), toolsProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureTools,
    async (_event, request: CaptureRequest): Promise<ToolsCaptureReportDto> => {
      return withAutoSync(request.dryRun, () =>
        captureTools(getContext(), toolsProvider, { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffRepos, async (): Promise<ReposDiffReportDto> => {
    return diffRepos(getContext())
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureRepos,
    async (_event, request: CaptureRequest): Promise<ReposCaptureReportDto> => {
      return withAutoSync(request.dryRun, () =>
        captureRepos(getContext(), gitProvider, { dryRun: request.dryRun })
      )
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineGetDoctorReport, async (): Promise<DoctorReportDto> => {
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
  })

  ipcMain.handle(
    IPC_CHANNELS.engineIgnoreDoctorCheck,
    async (_event, request: IgnoreDoctorCheckRequest): Promise<DoctorReportDto> => {
      await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
      ignoreDoctorCheck(getContext(), request.name, request.ignored)
      autoSyncAfterWrite(getContext(), gitTransportProvider)
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
  )

  ipcMain.handle(
    IPC_CHANNELS.engineGetLastDriftCheck,
    async (): Promise<DriftSummaryDto | null> => {
      return getLastDriftCheck()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.engineCompleteOnboarding,
    async (_event, request: CompleteOnboardingRequest): Promise<CompleteOnboardingResponse> => {
      await completeOnboarding(request, {
        homeDir: getContext().homeDir,
        execPath: getExecPath(),
        isDev: is.dev,
        gitTransportProvider
      })
      refreshEngineContext()
      onConfigChanged()
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
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.engineValidateManifestPath,
    async (_event, request: ValidateManifestPathRequest): Promise<ManifestPathCheckDto> => {
      const targetDir = expandTilde(request.manifestDir, getContext().homeDir)
      return checkExistingManifestPath(targetDir, gitTransportProvider)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.engineCloneManifestRepo,
    async (_event, request: CloneManifestRepoRequest): Promise<CloneManifestRepoResponse> => {
      const ctx = getContext()
      const targetDir = expandTilde(request.manifestDir, ctx.homeDir)
      const result = cloneManifestRepo(request.repoUrl.trim(), targetDir, gitTransportProvider)
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
      refreshEngineContext()
      onConfigChanged()
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
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineGetSyncStatus, async (): Promise<SyncStatusDto> => {
    return getLastSyncStatus(getContext(), gitTransportProvider)
  })

  ipcMain.handle(IPC_CHANNELS.engineSyncNow, async (): Promise<SyncStatusDto> => {
    return triggerSync(getContext(), gitTransportProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineSetAutostart,
    async (_event, request: SetAutostartRequest): Promise<EngineStatus> => {
      guardedSetAutostart(getContext().homeDir, request.enabled, getExecPath(), is.dev)
      // config.toml에도 반영해야 다음 실행에도 유지된다.
      const ctx = getContext()
      writeConfigFile(ctx.homeDir, {
        machineId: ctx.machineId,
        role: ctx.role,
        manifestDir: ctx.manifestDir,
        autostartEnabled: request.enabled,
        ...(ctx.profile ? { profile: ctx.profile } : {})
      })
      refreshEngineContext()
      const { ctx: newCtx, firstRun } = resolved
      return {
        machineId: newCtx.machineId,
        role: newCtx.role,
        manifestDir: newCtx.manifestDir,
        firstRun,
        autostartEnabled: newCtx.autostartEnabled
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineGetConfig, async (): Promise<RigsyncConfigDto> => {
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
  })

  ipcMain.handle(
    IPC_CHANNELS.engineUpdateConfig,
    async (_event, request: UpdateConfigRequest): Promise<RigsyncConfigDto> => {
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
      guardedSetAutostart(homeDir, request.autostartEnabled, getExecPath(), is.dev)
      // R1: main이 캐시한 ctx를 즉시 무효화 + 스케줄러(간격)·트레이(다음 체크
      // 표시)까지 재해석되게 index.ts의 onConfigChanged를 그대로 재사용한다
      // (온보딩 완료 경로와 동일한 갱신 통로).
      refreshEngineContext()
      onConfigChanged()
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
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDetectDuplicates, async (): Promise<DuplicateWarningDto[]> => {
    return detectDuplicates(getContext(), providers, gearLeverProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineDetectReclassifications,
    async (): Promise<ReclassificationEventDto[]> => {
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
    }
  )

  // R6 R1: listSyncItemGroups()의 순수 결과(engine 테스트 계약)는 그대로 두고,
  // IPC 경계에서만 withSyncItemState()로 감싸 renderer DTO에 4상태
  // (synced/pending-add/pending-remove/excluded)를 실어 보낸다.
  async function listSyncItemGroupsForRenderer(): Promise<SyncItemGroupDto[]> {
    const groups = await listSyncItemGroups(
      getContext(),
      providers,
      gearLeverProvider,
      toolsProvider,
      gitProvider
    )
    return [...withSyncItemState(groups)]
  }

  ipcMain.handle(IPC_CHANNELS.engineListSyncItems, async (): Promise<SyncItemGroupDto[]> => {
    return listSyncItemGroupsForRenderer()
  })

  ipcMain.handle(
    IPC_CHANNELS.engineToggleIgnore,
    async (_event, request: ToggleIgnoreRequest): Promise<SyncItemGroupDto[]> => {
      await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
      // refactor-spec-v0.2 §1: "배포판 기본" 그룹의 스위치는 ignore가 아니라
      // include 예외를 움직인다 -- 스위치 의미(켬=동기화)는 같으므로
      // synced = !ignored로 번역해 라우팅한다.
      if (request.subgroup === 'apt-distro') {
        toggleAptDistroSyncedBulk(getContext(), [request.key], !request.ignored)
      } else {
        toggleSyncItemIgnore(getContext(), request.capability, request.key, request.ignored)
      }
      autoSyncAfterWrite(getContext(), gitTransportProvider)
      return listSyncItemGroupsForRenderer()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.engineToggleIgnoreBulk,
    async (_event, request: ToggleIgnoreBulkRequest): Promise<SyncItemGroupDto[]> => {
      await sweepLiveEditsBeforeWrite(getContext(), gitTransportProvider)
      // R5: 그룹 전체 토글 -- ignore.toml 1회 읽기/쓰기(toggleSyncItemIgnoreBulk
      // 내부)에 이어 자동 commit+push도 정확히 1번만 트리거한다(항목별 루프로
      // 얹으면 커밋 폭탄이 되므로 절대 반복 호출하지 않는다).
      if (request.subgroup === 'apt-distro') {
        toggleAptDistroSyncedBulk(getContext(), request.keys, !request.ignored)
      } else {
        toggleSyncItemIgnoreBulk(getContext(), request.capability, request.keys, request.ignored)
      }
      autoSyncAfterWrite(getContext(), gitTransportProvider)
      return listSyncItemGroupsForRenderer()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.engineApply,
    async (_event, request: ApplyRequest): Promise<ApplyResponse> => {
      const ctx = getContext()
      const plan = await buildCombinedPlan(ctx, runTimestamp())

      const send = (event: PlanEvent): void => {
        getMainWindow()?.webContents.send(IPC_CHANNELS.enginePlanEvent, event)
      }

      const runner = new ApplyRunner()
      currentApplyRunner = runner
      runner.on('action_start', (payload) => send({ type: 'action_start', ...payload }))
      runner.on('action_done', (payload) => send({ type: 'action_done', ...payload }))
      let summary: PlanSummaryDto = { ok: 0, failed: 0, skipped: 0, cancelled: 0 }
      runner.on('summary', (payload) => {
        summary = payload
        send({ type: 'summary', summary: payload })
      })

      try {
        const results = await runner.run(plan, {
          confirm: request.confirm,
          elevationExec: linuxElevationExec
        })
        // 확인 다이얼로그(dry-run 프리뷰)에서만 스크립트 전문을 보여준다 —
        // 실행 후 응답엔 필요 없다(불변식 ⑥은 "실행 전 노출"이 핵심).
        const sudoScriptPreview = request.confirm
          ? undefined
          : (buildSudoScriptPreview(plan) ?? undefined)
        return { results, summary, sudoScriptPreview }
      } finally {
        currentApplyRunner = null
      }
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineCancelApply, async (): Promise<void> => {
    currentApplyRunner?.cancel()
  })

  // 항목 삭제(uninstall, 안전 불변식 5) — 순수 dry-run 미리보기. 아무것도
  // 실행하지 않고 planUninstall()이 계산한 명령 전문·제외 사유·apt 의존성
  // 경고만 돌려준다(확인 다이얼로그가 그대로 노출 — 불변식 ⑥).
  ipcMain.handle(
    IPC_CHANNELS.enginePlanUninstall,
    async (_event, request: PlanUninstallRequest): Promise<PlanUninstallResponse> => {
      const ctx = getContext()
      const plan = planUninstall(ctx, uninstallProviders, request.items, runTimestamp())
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
    }
  )

  // 항목 삭제 실행 — plan을 다시 계산해(engine:apply와 동일 패턴: preview와
  // run이 각자 새로 plan을 만든다) 기존 ApplyRunner·`engine:planEvent` 이벤트
  // 스트림·`engine:cancelApply` 취소 경로를 그대로 태운다(코디네이터 지시 —
  // 실행기를 새로 만들지 않는다).
  ipcMain.handle(
    IPC_CHANNELS.engineRunUninstall,
    async (_event, request: RunUninstallRequest): Promise<RunUninstallResponse> => {
      const ctx = getContext()
      const plan = planUninstall(ctx, uninstallProviders, request.items, runTimestamp())

      const send = (event: PlanEvent): void => {
        getMainWindow()?.webContents.send(IPC_CHANNELS.enginePlanEvent, event)
      }

      const runner = new ApplyRunner()
      currentApplyRunner = runner
      runner.on('action_start', (payload) => send({ type: 'action_start', ...payload }))
      runner.on('action_done', (payload) => send({ type: 'action_done', ...payload }))
      let summary: PlanSummaryDto = { ok: 0, failed: 0, skipped: 0, cancelled: 0 }
      runner.on('summary', (payload) => {
        summary = payload
        send({ type: 'summary', summary: payload })
      })

      try {
        const results = await runner.run(plan.actions, {
          confirm: true,
          elevationExec: linuxElevationExec
        })
        return { results, summary }
      } finally {
        currentApplyRunner = null
      }
    }
  )
}

/** 온보딩 위저드(P4) 완료 후 config.toml이 새로 쓰였을 때 캐시를 갱신하기 위한 훅. */
export function refreshEngineContext(): void {
  resolved = resolveContext()
}
