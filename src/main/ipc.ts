/**
 * engine IPC 핸들러 등록 — main 프로세스에서 딱 한 번 호출한다(`app.whenReady`
 * 안에서). `ipcMain.handle`은 같은 채널에 두 번 등록하면 던지므로, 창이
 * (macOS activate로) 다시 만들어져도 여기는 재실행되지 않는다 — 창 참조는
 * `getMainWindow` 콜백으로 늦게 묶는다(P1 확정 결정 ⑤·⑥).
 *
 * P2a: packages capability(apt/snap/flatpak)가 추가되면서 `engine:apply`는
 * dotfiles + packages 두 capability의 plan을 합쳐 하나의 PlanExecutor로
 * 실행한다 — privileged 액션(apt/snap)은 executor가 알아서 skipped 처리한다.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { captureDotfiles } from '../engine/capabilities/dotfiles/capture'
import { diffDotfiles } from '../engine/capabilities/dotfiles/diff'
import { planDotfiles } from '../engine/capabilities/dotfiles/plan'
import { capturePackages } from '../engine/capabilities/packages/capture'
import { diffPackages } from '../engine/capabilities/packages/diff'
import { planPackages } from '../engine/capabilities/packages/plan'
import { resolveContext, type RigsyncContext } from '../engine/context'
import { linuxPackageProviders } from '../engine/providers/linux'
import { PlanExecutor } from '../engine/plan'
import { listSyncItemGroups, toggleSyncItemIgnore } from '../engine/syncItems'
import {
  IPC_CHANNELS,
  type ApplyRequest,
  type ApplyResponse,
  type CaptureDotfilesRequest,
  type CapturePackagesRequest,
  type DotfilesCaptureReport,
  type DotfilesDiffReport,
  type EngineStatus,
  type PackagesCaptureReport,
  type PackagesDiffReport,
  type PlanEvent,
  type PlanSummaryDto,
  type SyncItemGroupDto,
  type ToggleIgnoreRequest
} from '../shared/ipc'

// packages capability의 provider 묶음 -- v1은 Linux 고정 (FORWARD.md §3: "v1은
// Linux provider만"). darwin/win32가 생기면 process.platform으로 분기한다.
const providers = linuxPackageProviders

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

  ipcMain.handle(IPC_CHANNELS.engineListSyncItems, async (): Promise<SyncItemGroupDto[]> => {
    return listSyncItemGroups(getContext(), providers)
  })

  ipcMain.handle(
    IPC_CHANNELS.engineToggleIgnore,
    async (_event, request: ToggleIgnoreRequest): Promise<SyncItemGroupDto[]> => {
      toggleSyncItemIgnore(getContext(), request.capability, request.key, request.ignored)
      return listSyncItemGroups(getContext(), providers)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.engineApply,
    async (_event, request: ApplyRequest): Promise<ApplyResponse> => {
      const ctx = getContext()
      const dotfilesDiff = await diffDotfiles(ctx)
      const packagesDiff = await diffPackages(ctx, providers)
      const runTs = runTimestamp()
      const plan = [
        ...planDotfiles(ctx, dotfilesDiff, runTs),
        ...planPackages(ctx, providers, packagesDiff)
      ]

      const send = (event: PlanEvent): void => {
        getMainWindow()?.webContents.send(IPC_CHANNELS.enginePlanEvent, event)
      }

      const executor = new PlanExecutor()
      executor.on('action_start', (payload) => send({ type: 'action_start', ...payload }))
      executor.on('action_done', (payload) => send({ type: 'action_done', ...payload }))
      let summary: PlanSummaryDto = { ok: 0, failed: 0, skipped: 0, cancelled: 0 }
      executor.on('summary', (payload) => {
        summary = payload
        send({ type: 'summary', summary: payload })
      })

      const results = await executor.execute(plan, { confirm: request.confirm })
      return { results, summary }
    }
  )
}

/** 온보딩 위저드(P4) 완료 후 config.toml이 새로 쓰였을 때 캐시를 갱신하기 위한 훅. */
export function refreshEngineContext(): void {
  resolved = resolveContext()
}
