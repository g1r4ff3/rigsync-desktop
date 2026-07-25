import { app, shell, BrowserWindow, ipcMain, nativeTheme, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { DEFAULT_DRIFT_CHECK_INTERVAL_HOURS } from '../engine/context'
import { isAutostartEnabled, setAutostart } from '../engine/autostart'
import type { DriftSummary } from '../engine/drift'
import { runDriftCheck } from './driftCheck'
import { getEngineContext, refreshEngineContext, registerEngineIpc } from './ipc'
import { runScreenshotHarness } from './screenshot'
import { createDriftCheckScheduler, type DriftCheckScheduler } from './scheduler'
import { createAppTray, type AppTray } from './tray'
import { IPC_CHANNELS } from '../shared/ipc'

/**
 * R4 스크린샷 하네스 트리거 — `RIGSYNC_SCREENSHOT_DIR`가 설정돼 있으면 이
 * 프로세스는 평상시 앱이 아니라 캡처 도구로 동작한다. GPU 비활성화는
 * `app.whenReady()` **이전에** 해야 적용된다(Electron 문서화된 제약) — 그래서
 * 이 블록은 모듈 최상단, 다른 어떤 app.* 호출보다도 먼저 온다.
 */
const screenshotDir = process.env.RIGSYNC_SCREENSHOT_DIR
if (screenshotDir) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

/**
 * R1a 검증 보조 — `RIGSYNC_SCREENSHOT_THEME=light|dark`가 있으면 강제로 그
 * 테마의 `prefers-color-scheme`로 렌더한다(OS 설정과 무관하게 두 테마를 모두
 * 스크린샷 루프로 검증하기 위한 dev 전용 스위치 — screenshotDir 하네스와 짝을
 * 이룬다). `nativeTheme.themeSource`는 Electron이 renderer의
 * `prefers-color-scheme` media query에 그대로 반영하는 공식 API라 CSS를
 * 건드리지 않고 강제할 수 있다. 값이 없으면(보통 실행) 'system'과 동일하게
 * OS를 따른다 — 평상시 동작에는 관여하지 않는다.
 */
const screenshotTheme = process.env.RIGSYNC_SCREENSHOT_THEME
if (screenshotTheme === 'light' || screenshotTheme === 'dark') {
  nativeTheme.themeSource = screenshotTheme
}

/**
 * autostart .desktop의 Exec= 값 + registerEngineIpc가 요구하는 execPath.
 * AppImage로 실행 중이면 AppImage 런타임이 `$APPIMAGE`에 마운트 전 원본
 * 경로를 넣어준다(패키징 산출물 자기 경로 찾기의 표준 관례) — 아니면(dev,
 * 또는 다른 패키징) Electron 실행파일 경로로 fallback.
 */
function resolveExecPath(): string {
  return process.env.APPIMAGE || process.execPath
}

let mainWindow: BrowserWindow | null = null
let scheduler: DriftCheckScheduler | null = null
let tray: AppTray | null = null
// 트레이 "종료"로만 실제 quit — 창 X 버튼은 hide로 가로챈다(P3 결정 ② — "창
// 닫기 = 트레이로 숨김, 앱 종료 아님").
let isQuitting = false

function createWindow(): void {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // renderer는 렌더만 — 시스템 접근은 항상 contextBridge IPC를 거친다
      // (CLAUDE.md 아키텍처 규칙).
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  // P3 결정 ② — 창을 닫아도 앱은 종료되지 않고 트레이로 숨는다. 실제 종료는
  // 트레이 메뉴 "종료"(app.quit() -> before-quit에서 isQuitting=true)로만.
  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** 알림 클릭 시: 창을 보여주고 renderer에 "Diff 탭 열어라" push (P3 결정 ①). */
function focusDiffTab(): void {
  showMainWindow()
  mainWindow?.webContents.send(IPC_CHANNELS.engineFocusDiffTab)
}

function notifyDrift(summary: DriftSummary): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: 'rigsync',
    body: `main이 기준과 다름 — 항목 ${summary.total}개`
  })
  notification.on('click', focusDiffTab)
  notification.show()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // P3: 스케줄러 -- 판단(shouldNotify)은 engine/drift.ts, 여기는 실제
  // read-only diff 호출(driftCheck.ts) + electron Notification 연결만.
  scheduler = createDriftCheckScheduler({
    runCheck: () => runDriftCheck(getEngineContext()),
    notify: notifyDrift,
    intervalHours:
      getEngineContext().settings.driftCheckIntervalHours ?? DEFAULT_DRIFT_CHECK_INTERVAL_HOURS
  })

  // 한 번만 등록 -- ipcMain.handle은 같은 채널 재등록 시 던진다. 창은
  // (macOS activate로) 다시 만들어질 수 있어 참조를 콜백으로 늦게 묶는다.
  registerEngineIpc(() => mainWindow, {
    getLastDriftCheck: () => scheduler?.getLastResult() ?? null,
    onConfigChanged: refreshSchedulerAfterOnboarding,
    getExecPath: resolveExecPath
  })

  createWindow()

  // P3: 트레이 -- "열기"/"지금 확인"/마지막 확인 라벨/"종료". P4: 자동 시작
  // 체크박스도 여기 추가(온보딩 ⑤와 같은 토글). 아이콘은 placeholder(design
  // pass 예정, trayIcon.ts 주석 참조).
  tray = createAppTray({
    showWindow: showMainWindow,
    runCheckNow: () => scheduler?.runNow() ?? Promise.resolve(),
    quit: () => app.quit(),
    getLastResult: () => scheduler?.getLastResult() ?? null,
    isAutostartEnabled: () => isAutostartEnabled(getEngineContext().homeDir),
    toggleAutostart: (enabled) =>
      setAutostart(getEngineContext().homeDir, enabled, resolveExecPath())
  })

  scheduler.start()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
  })

  if (screenshotDir) {
    const win = mainWindow
    win?.webContents.once('did-finish-load', () => {
      // renderer가 첫 status/config를 IPC로 받아올 시간을 조금 더 준다.
      setTimeout(() => {
        runScreenshotHarness(win, screenshotDir)
          .then((results) => {
            for (const r of results) {
              console.log(`[screenshot] ${r.file}: ${r.ok ? 'ok' : `FAILED (${r.error})`}`)
            }
          })
          .catch((err: unknown) => console.error('[screenshot] harness threw', err))
          .finally(() => {
            isQuitting = true
            app.quit()
          })
      }, 1000)
    })
  }
})

// P3: 창을 닫아도(hide) 프로세스가 살아있어야 트레이 상주가 의미 있으므로,
// "창이 전부 닫히면 종료"라는 기존 규칙을 더 이상 쓰지 않는다 — 종료는
// 트레이 메뉴로만.
app.on('before-quit', () => {
  isQuitting = true
  scheduler?.stop()
  tray?.destroy()
})

/** 온보딩 위저드(P4)가 config.toml을 새로 쓴 뒤 스케줄러 간격도 다시 읽어야 한다. */
export function refreshSchedulerAfterOnboarding(): void {
  refreshEngineContext()
  const ctx = getEngineContext()
  scheduler?.stop()
  scheduler = createDriftCheckScheduler({
    runCheck: () => runDriftCheck(getEngineContext()),
    notify: notifyDrift,
    intervalHours: ctx.settings.driftCheckIntervalHours ?? DEFAULT_DRIFT_CHECK_INTERVAL_HOURS
  })
  scheduler.start()
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
