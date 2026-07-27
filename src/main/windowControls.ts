/**
 * 커스텀 타이틀바(frame:false) 창 제어 IPC — UI 정돈(v0.1.16)에서 GTK 기본
 * 타이틀바를 제거하며 추가됐다. engine IPC(ipc.ts)와 분리된 얇은 레이어다 —
 * 최소화/최대화/닫기는 엔진 워커를 거칠 이유가 없는 순수 BrowserWindow 조작.
 *
 * 창 참조는 getMainWindow 콜백으로 늦게 묶는다(ipc.ts registerEngineIpc와
 * 같은 이유 — macOS activate로 창이 다시 만들어질 수 있음, 지금은 Linux
 * 전용이지만 관례를 맞춘다). ipcMain.handle은 같은 채널 재등록 시 던지므로
 * 앱 생애주기에서 한 번만 호출한다.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import { WINDOW_IPC_CHANNELS } from '../shared/ipc'

export function registerWindowControlIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(WINDOW_IPC_CHANNELS.windowMinimize, () => {
    getMainWindow()?.minimize()
  })
  ipcMain.handle(WINDOW_IPC_CHANNELS.windowToggleMaximize, () => {
    const win = getMainWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(WINDOW_IPC_CHANNELS.windowClose, () => {
    // win.close()는 기존 'close' 핸들러(main/index.ts)를 그대로 탄다 -- 실제
    // 종료가 아니라 트레이로 숨는다(P3 결정 ②, 이 버튼도 예외 없이 동일).
    getMainWindow()?.close()
  })
  ipcMain.handle(WINDOW_IPC_CHANNELS.windowIsMaximized, () => {
    return getMainWindow()?.isMaximized() ?? false
  })
}

/** createWindow()가 win 생성 직후 호출 -- 최대화/복원 상태 변화를 타이틀바에 push한다. */
export function wireWindowMaximizeEvents(win: BrowserWindow): void {
  const send = (): void => {
    win.webContents.send(WINDOW_IPC_CHANNELS.windowMaximizeChanged, win.isMaximized())
  }
  win.on('maximize', send)
  win.on('unmaximize', send)
}
