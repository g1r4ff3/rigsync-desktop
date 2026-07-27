import { app, shell, BrowserWindow, ipcMain, nativeTheme, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { DEFAULT_DRIFT_CHECK_INTERVAL_HOURS } from '../engine/context'
import { isAutostartEnabled } from '../engine/autostart'
import { guardedSetAutostart } from './autostartGuard'
import type { DriftSummary } from '../engine/drift'
import {
  disposeEngineWorker,
  getEngineContext,
  refreshEngineContext,
  registerEngineIpc,
  runEngineDriftCheck
} from './ipc'
import { runScreenshotHarness } from './screenshot'
import { createDriftCheckScheduler, type DriftCheckScheduler } from './scheduler'
import { createAppTray, type AppTray } from './tray'
import { registerWindowControlIpc, wireWindowMaximizeEvents } from './windowControls'
import { IPC_CHANNELS } from '../shared/ipc'
import { LinuxGearLeverProvider } from '../engine/providers/linux/gearlever'
import {
  attemptSelfUpdateRegistration,
  readSelfUpdateState,
  writeSelfUpdateState
} from './selfUpdate'

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
    // UI 정돈(v0.1.16): GTK 기본 타이틀바 제거 -- 자체 TitleBar 컴포넌트
    // (renderer)가 드래그 영역 + 창 제어 버튼을 그린다. Linux 전용 앱이라
    // titleBarOverlay(Windows/macOS 전용 API)는 쓰지 않는다. resizable은
    // 기본값이 true지만, frame:false에서도 유지돼야 함을 명시해 둔다 --
    // Linux WM(Mutter/KWin 등)은 override-redirect가 아닌 한 undecorated
    // top-level 창도 가장자리 드래그로 리사이즈를 계속 지원한다(VSCode·
    // Discord 등 frame:false 앱과 동일 전제).
    frame: false,
    resizable: true,
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
  // UI 정돈(v0.1.16): TitleBar가 최대화/복원 아이콘을 그리려면 그 상태 변화를
  // 알아야 한다 -- 창 컨트롤 IPC(registerWindowControlIpc)와 짝을 이룬다.
  wireWindowMaximizeEvents(win)

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

/**
 * P4: 이미 설치된(embed 없는) 구버전 AppImage 구제용 런타임 자기 등록 — 판단은
 * `src/main/selfUpdate.ts`(순수, fake로 유닛 테스트됨), 여기는 실제 Gear Lever
 * CLI provider + `app.getPath('userData')` 상태 파일 배선만 한다.
 *
 * `createWindow()` 이후 지연 실행하는 이유: Gear Lever CLI 호출(`flatpak run
 * it.mijorus.gearlever …`)은 동기(`execFileSync`)라 호출 중엔 메인 프로세스가
 * 블록된다 — "실패해도 기동을 막지 말고"라는 명세를 지키려고, 창이 이미
 * 뜬 뒤(사용자가 화면을 보기 시작한 뒤)로 미뤄 초기 페인트를 지연시키지
 * 않는다. 대부분의 실행에서는 이미 한 번 시도돼 상태 파일에 기록돼 있어
 * `readState()`만 보고 즉시 반환한다(비용 무시할 수준).
 */
function runSelfUpdateRegistration(): void {
  const gearLeverProvider = new LinuxGearLeverProvider()
  const userDataDir = app.getPath('userData')
  try {
    attemptSelfUpdateRegistration({
      appImagePath: process.env.APPIMAGE || null,
      isGearLeverAvailable: () => gearLeverProvider.isAvailable(),
      readAppConfig: (appImagePath) => gearLeverProvider.readAppConfig(appImagePath),
      setUpdateSource: (appImagePath, manager, params) =>
        gearLeverProvider.setUpdateSource(appImagePath, manager, params),
      readState: () => readSelfUpdateState(userDataDir),
      writeState: (state) => writeSelfUpdateState(userDataDir, state),
      log: (message) => console.log(message)
    })
  } catch (err) {
    // attemptSelfUpdateRegistration 자체가 이미 내부에서 삼키지만, 이 배선
    // 함수(provider 생성·app.getPath 등)에서 던질 가능성까지 이중으로 막는다
    // — 자기 등록은 기동을 절대 막아선 안 된다.
    console.error('[self-update] wiring failed (non-fatal)', err)
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
    runCheck: () => runEngineDriftCheck(),
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
  registerWindowControlIpc(() => mainWindow)

  createWindow()

  // P4: 창이 뜬 뒤로 미뤄 자기 등록(동기 CLI 호출)이 초기 페인트를 지연시키지
  // 않게 한다 (runSelfUpdateRegistration 주석 참조). 스크린샷 하네스 실행 중엔
  // Gear Lever/flatpak이 없는 CI 환경일 수 있어(그리고 실제 앱 상태를 흔들 수
  // 있어) 건너뛴다.
  if (!screenshotDir) {
    setTimeout(runSelfUpdateRegistration, 3000)
  }

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
      guardedSetAutostart(getEngineContext().homeDir, enabled, resolveExecPath(), is.dev)
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
  // 엔진 워커도 여기서 명시적으로 내린다 -- 안 하면 앱 종료로 죽는 워커를
  // client가 "예기치 않은 크래시"로 오인해 재기동을 시도한다(실행 확인 중 발견).
  disposeEngineWorker()
})

/** 온보딩 위저드(P4)가 config.toml을 새로 쓴 뒤 스케줄러 간격도 다시 읽어야 한다. */
export function refreshSchedulerAfterOnboarding(): void {
  refreshEngineContext()
  const ctx = getEngineContext()
  scheduler?.stop()
  scheduler = createDriftCheckScheduler({
    runCheck: () => runEngineDriftCheck(),
    notify: notifyDrift,
    intervalHours: ctx.settings.driftCheckIntervalHours ?? DEFAULT_DRIFT_CHECK_INTERVAL_HOURS
  })
  scheduler.start()
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
