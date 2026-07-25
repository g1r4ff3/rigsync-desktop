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
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { captureDotfiles } from '../engine/capabilities/dotfiles/capture'
import { diffDotfiles } from '../engine/capabilities/dotfiles/diff'
import { planDotfiles } from '../engine/capabilities/dotfiles/plan'
import { capturePackages } from '../engine/capabilities/packages/capture'
import { diffPackages } from '../engine/capabilities/packages/diff'
import { planPackages } from '../engine/capabilities/packages/plan'
import { resolveContext, type RigsyncContext } from '../engine/context'
import { ApplyRunner, buildSudoScriptPreview } from '../engine/elevation'
import { linuxElevationExec, linuxPackageProviders } from '../engine/providers/linux'
import type { PlanAction } from '../engine/plan'
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

async function buildCombinedPlan(ctx: RigsyncContext, runTs: string): Promise<PlanAction[]> {
  const dotfilesDiff = await diffDotfiles(ctx)
  const packagesDiff = await diffPackages(ctx, providers)
  return [
    ...planDotfiles(ctx, dotfilesDiff, runTs),
    ...planPackages(ctx, providers, packagesDiff, runTs)
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
