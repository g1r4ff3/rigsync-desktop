import { ElectronAPI } from '@electron-toolkit/preload'
import type { DotfilesApi, EngineApi, WindowControlsApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: { engine: EngineApi; windowControls: WindowControlsApi; dotfiles: DotfilesApi }
  }
}
