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
import { captureAppimage } from '../engine/capabilities/appimage/capture'
import { diffAppimage } from '../engine/capabilities/appimage/diff'
import { planAppimage } from '../engine/capabilities/appimage/plan'
import { captureDotfiles } from '../engine/capabilities/dotfiles/capture'
import { diffDotfiles } from '../engine/capabilities/dotfiles/diff'
import { planDotfiles } from '../engine/capabilities/dotfiles/plan'
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
import { resolveContext, type RigsyncContext } from '../engine/context'
import { buildDoctorReport } from '../engine/doctor/report'
import { ignoreDoctorCheck } from '../engine/doctor/toggle'
import { ApplyRunner, buildSudoScriptPreview } from '../engine/elevation'
import { detectDuplicates } from '../engine/duplicates'
import type { PlanAction } from '../engine/plan'
import {
  linuxAssetResolver,
  linuxCronProvider,
  linuxDconfProvider,
  linuxDoctorSystemProvider,
  linuxDownloader,
  linuxElevationExec,
  linuxGearLeverProvider,
  linuxGitProvider,
  linuxPackageProviders,
  linuxSystemdUserProvider,
  linuxToolsProvider,
  linuxAppimageSystemCheck
} from '../engine/providers/linux'
import { detectReclassifications } from '../engine/reclassification'
import { listSyncItemGroups, toggleSyncItemIgnore } from '../engine/syncItems'
import {
  IPC_CHANNELS,
  type ApplyRequest,
  type ApplyResponse,
  type AppimageCaptureReportDto,
  type AppimageDiffReportDto,
  type CaptureAppimageRequest,
  type CaptureDotfilesRequest,
  type CapturePackagesRequest,
  type CaptureRequest,
  type DoctorReportDto,
  type DotfilesCaptureReport,
  type DotfilesDiffReport,
  type DuplicateWarningDto,
  type EngineStatus,
  type IgnoreDoctorCheckRequest,
  type PackagesCaptureReport,
  type PackagesDiffReport,
  type PlanEvent,
  type PlanSummaryDto,
  type ReclassificationEventDto,
  type ReposCaptureReportDto,
  type ReposDiffReportDto,
  type ScheduledCaptureReportDto,
  type ScheduledDiffReportDto,
  type ServicesCaptureReportDto,
  type ServicesDiffReportDto,
  type SettingsCaptureReportDto,
  type SettingsDiffReportDto,
  type SyncItemGroupDto,
  type ToggleIgnoreRequest,
  type ToolsCaptureReportDto,
  type ToolsDiffReportDto
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

// config.toml은 온보딩 위저드(P4) 전에는 없는 게 정상이라 dev 기본값으로
// 뜬다 — 앱 프로세스 생애주기 동안 한 번만 해석한다(전역 상태처럼 보이지만
// 이건 main 쪽 캐시일 뿐, 엔진 함수들은 여전히 이 ctx를 인자로 받는다).
let resolved = resolveContext()

function getContext(): RigsyncContext {
  return resolved.ctx
}

function runTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function buildCombinedPlan(ctx: RigsyncContext, runTs: string): Promise<PlanAction[]> {
  const [
    dotfilesDiff,
    packagesDiff,
    appimageDiff,
    settingsDiff,
    servicesDiff,
    scheduledDiff,
    toolsDiff,
    reposDiff
  ] = await Promise.all([
    diffDotfiles(ctx),
    diffPackages(ctx, providers),
    diffAppimage(ctx, gearLeverProvider),
    diffSettings(ctx, dconfProvider),
    diffServices(ctx, systemdUserProvider),
    diffScheduled(ctx, cronProvider),
    diffTools(ctx, toolsProvider),
    diffRepos(ctx)
  ])
  return [
    ...planDotfiles(ctx, dotfilesDiff, runTs),
    ...planPackages(ctx, providers, packagesDiff, runTs),
    ...planAppimage(ctx, gearLeverProvider, linuxAssetResolver, linuxDownloader, appimageDiff),
    ...planSettings(ctx, dconfProvider, settingsDiff),
    ...planServices(ctx, systemdUserProvider, servicesDiff, runTs),
    ...planScheduled(ctx, cronProvider, scheduledDiff, runTs),
    ...planTools(ctx, toolsProvider, toolsDiff),
    ...planRepos(ctx, gitProvider, reposDiff)
  ]
}

// 현재 진행 중인 apply의 ApplyRunner -- engine:cancelApply가 신호를 보낼
// 대상. invoke 하나가 한 번에 하나씩만 진행된다는 전제(동시에 두 Apply
// 클릭을 허용하지 않는 건 UI 쪽 책임)로 단순하게 모듈 변수 하나로 둔다.
let currentApplyRunner: ApplyRunner | null = null

export function registerEngineIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.engineGetStatus, async (): Promise<EngineStatus> => {
    const { ctx, firstRun } = resolved
    return { machineId: ctx.machineId, role: ctx.role, manifestDir: ctx.manifestDir, firstRun }
  })

  ipcMain.handle(IPC_CHANNELS.engineDiffDotfiles, async (): Promise<DotfilesDiffReport> => {
    return diffDotfiles(getContext())
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureDotfiles,
    async (_event, request: CaptureDotfilesRequest): Promise<DotfilesCaptureReport> => {
      return captureDotfiles(getContext(), { dryRun: request.dryRun })
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffPackages, async (): Promise<PackagesDiffReport> => {
    return diffPackages(getContext(), providers)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCapturePackages,
    async (_event, request: CapturePackagesRequest): Promise<PackagesCaptureReport> => {
      return capturePackages(getContext(), providers, { dryRun: request.dryRun })
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffAppimage, async (): Promise<AppimageDiffReportDto> => {
    return diffAppimage(getContext(), gearLeverProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureAppimage,
    async (_event, request: CaptureAppimageRequest): Promise<AppimageCaptureReportDto> => {
      return captureAppimage(getContext(), gearLeverProvider, { dryRun: request.dryRun })
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffSettings, async (): Promise<SettingsDiffReportDto> => {
    return diffSettings(getContext(), dconfProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureSettings,
    async (_event, request: CaptureRequest): Promise<SettingsCaptureReportDto> => {
      return captureSettings(getContext(), dconfProvider, { dryRun: request.dryRun })
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffServices, async (): Promise<ServicesDiffReportDto> => {
    return diffServices(getContext(), systemdUserProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureServices,
    async (_event, request: CaptureRequest): Promise<ServicesCaptureReportDto> => {
      return captureServices(getContext(), systemdUserProvider, { dryRun: request.dryRun })
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffScheduled, async (): Promise<ScheduledDiffReportDto> => {
    return diffScheduled(getContext(), cronProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureScheduled,
    async (_event, request: CaptureRequest): Promise<ScheduledCaptureReportDto> => {
      return captureScheduled(getContext(), cronProvider, { dryRun: request.dryRun })
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffTools, async (): Promise<ToolsDiffReportDto> => {
    return diffTools(getContext(), toolsProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureTools,
    async (_event, request: CaptureRequest): Promise<ToolsCaptureReportDto> => {
      return captureTools(getContext(), toolsProvider, { dryRun: request.dryRun })
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineDiffRepos, async (): Promise<ReposDiffReportDto> => {
    return diffRepos(getContext())
  })

  ipcMain.handle(
    IPC_CHANNELS.engineCaptureRepos,
    async (_event, request: CaptureRequest): Promise<ReposCaptureReportDto> => {
      return captureRepos(getContext(), gitProvider, { dryRun: request.dryRun })
    }
  )

  ipcMain.handle(IPC_CHANNELS.engineGetDoctorReport, async (): Promise<DoctorReportDto> => {
    return buildDoctorReport(
      getContext(),
      doctorSystemProvider,
      gearLeverProvider,
      linuxAppimageSystemCheck,
      { configConfigured: !resolved.firstRun }
    )
  })

  ipcMain.handle(
    IPC_CHANNELS.engineIgnoreDoctorCheck,
    async (_event, request: IgnoreDoctorCheckRequest): Promise<DoctorReportDto> => {
      ignoreDoctorCheck(getContext(), request.name, request.ignored)
      return buildDoctorReport(
        getContext(),
        doctorSystemProvider,
        gearLeverProvider,
        linuxAppimageSystemCheck,
        { configConfigured: !resolved.firstRun }
      )
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

  ipcMain.handle(IPC_CHANNELS.engineListSyncItems, async (): Promise<SyncItemGroupDto[]> => {
    return listSyncItemGroups(getContext(), providers, gearLeverProvider, toolsProvider)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineToggleIgnore,
    async (_event, request: ToggleIgnoreRequest): Promise<SyncItemGroupDto[]> => {
      toggleSyncItemIgnore(getContext(), request.capability, request.key, request.ignored)
      return listSyncItemGroups(getContext(), providers, gearLeverProvider, toolsProvider)
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
}

/** 온보딩 위저드(P4) 완료 후 config.toml이 새로 쓰였을 때 캐시를 갱신하기 위한 훅. */
export function refreshEngineContext(): void {
  resolved = resolveContext()
}
