import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
  type SyncItemGroupDto,
  type ToggleIgnoreRequest
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
  listSyncItems: (): Promise<SyncItemGroupDto[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineListSyncItems),
  toggleIgnore: (request: ToggleIgnoreRequest): Promise<SyncItemGroupDto[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineToggleIgnore, request),
  apply: (request: ApplyRequest): Promise<ApplyResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.engineApply, request),
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
