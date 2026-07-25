import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
  type CompleteOnboardingRequest,
  type CompleteOnboardingResponse,
  type DoctorReportDto,
  type DotfilesCaptureReport,
  type DotfilesDiffReport,
  type DriftSummaryDto,
  type DuplicateWarningDto,
  type EngineStatus,
  type IgnoreDoctorCheckRequest,
  type PackagesCaptureReport,
  type PackagesDiffReport,
  type PlanEvent,
  type ReclassificationEventDto,
  type ReposCaptureReportDto,
  type ReposDiffReportDto,
  type RigsyncConfigDto,
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
  type UpdateConfigRequest
} from '../shared/ipc'

// renderer가 시스템에 접근하는 유일한 경로 — 전부 src/shared/ipc.ts의 타입드
// 계약을 그대로 따른다 (CLAUDE.md 아키텍처 규칙).
const engineApi = {
  getStatus: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC_CHANNELS.engineGetStatus),
  diffDotfiles: (): Promise<DotfilesDiffReport> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineDiffDotfiles),
  captureDotfiles: (request: CaptureDotfilesRequest): Promise<DotfilesCaptureReport> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCaptureDotfiles, request),
  diffPackages: (): Promise<PackagesDiffReport> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineDiffPackages),
  capturePackages: (request: CapturePackagesRequest): Promise<PackagesCaptureReport> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCapturePackages, request),
  diffAppimage: (): Promise<AppimageDiffReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineDiffAppimage),
  captureAppimage: (request: CaptureAppimageRequest): Promise<AppimageCaptureReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCaptureAppimage, request),
  diffSettings: (): Promise<SettingsDiffReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineDiffSettings),
  captureSettings: (request: CaptureRequest): Promise<SettingsCaptureReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCaptureSettings, request),
  diffServices: (): Promise<ServicesDiffReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineDiffServices),
  captureServices: (request: CaptureRequest): Promise<ServicesCaptureReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCaptureServices, request),
  diffScheduled: (): Promise<ScheduledDiffReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineDiffScheduled),
  captureScheduled: (request: CaptureRequest): Promise<ScheduledCaptureReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCaptureScheduled, request),
  diffTools: (): Promise<ToolsDiffReportDto> => ipcRenderer.invoke(IPC_CHANNELS.engineDiffTools),
  captureTools: (request: CaptureRequest): Promise<ToolsCaptureReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCaptureTools, request),
  diffRepos: (): Promise<ReposDiffReportDto> => ipcRenderer.invoke(IPC_CHANNELS.engineDiffRepos),
  captureRepos: (request: CaptureRequest): Promise<ReposCaptureReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCaptureRepos, request),
  getDoctorReport: (): Promise<DoctorReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineGetDoctorReport),
  ignoreDoctorCheck: (request: IgnoreDoctorCheckRequest): Promise<DoctorReportDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineIgnoreDoctorCheck, request),
  getLastDriftCheck: (): Promise<DriftSummaryDto | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineGetLastDriftCheck),
  /** 트레이 알림 클릭 시 main -> renderer "Diff 탭으로 전환" push 구독. */
  onFocusDiffTab: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.engineFocusDiffTab, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.engineFocusDiffTab, listener)
  },
  completeOnboarding: (request: CompleteOnboardingRequest): Promise<CompleteOnboardingResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineCompleteOnboarding, request),
  getSyncStatus: (): Promise<SyncStatusDto> => ipcRenderer.invoke(IPC_CHANNELS.engineGetSyncStatus),
  syncNow: (): Promise<SyncStatusDto> => ipcRenderer.invoke(IPC_CHANNELS.engineSyncNow),
  setAutostart: (request: SetAutostartRequest): Promise<EngineStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineSetAutostart, request),
  /** R1: 첫 실행 이후 설정 화면. */
  getConfig: (): Promise<RigsyncConfigDto> => ipcRenderer.invoke(IPC_CHANNELS.engineGetConfig),
  updateConfig: (request: UpdateConfigRequest): Promise<RigsyncConfigDto> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineUpdateConfig, request),
  detectDuplicates: (): Promise<DuplicateWarningDto[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineDetectDuplicates),
  detectReclassifications: (): Promise<ReclassificationEventDto[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineDetectReclassifications),
  listSyncItems: (): Promise<SyncItemGroupDto[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineListSyncItems),
  toggleIgnore: (request: ToggleIgnoreRequest): Promise<SyncItemGroupDto[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineToggleIgnore, request),
  /** R5: Candidates 그룹 전체 토글 — ignore.toml 1회 읽기/쓰기 + 자동 커밋도 1회. */
  toggleIgnoreBulk: (request: ToggleIgnoreBulkRequest): Promise<SyncItemGroupDto[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineToggleIgnoreBulk, request),
  apply: (request: ApplyRequest): Promise<ApplyResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineApply, request),
  /** 실행 중인 apply를 취소한다 (P2b 결정 ③ — 명령 사이에서 협조적으로 중단). */
  cancelApply: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.engineCancelApply),
  /** `engine:planEvent` push 구독. 반환값을 호출하면 구독을 해제한다. */
  onPlanEvent: (callback: (event: PlanEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PlanEvent): void =>
      callback(payload)
    ipcRenderer.on(IPC_CHANNELS.enginePlanEvent, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.enginePlanEvent, listener)
  }
}

const api = { engine: engineApi }

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type EngineApi = typeof engineApi
