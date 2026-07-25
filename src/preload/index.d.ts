import { ElectronAPI } from '@electron-toolkit/preload'
import type { EngineApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: { engine: EngineApi }
  }
}
