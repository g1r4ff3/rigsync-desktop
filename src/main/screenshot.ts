/**
 * R4 검증 도구 — dev 전용 스크린샷 하네스. `RIGSYNC_SCREENSHOT_DIR=<dir>`가
 * 설정된 채로 앱을 띄우면(`npm run dev` 또는 빌드본) 앱이 부팅 후 각 화면을
 * 차례로 렌더해 PNG로 저장하고 자동 종료한다. UI 변경(디자인 패스·explainability
 * 문구 추가 등)을 텍스트 리뷰가 아니라 실제 렌더 결과로 검증하기 위한 것 —
 * CLAUDE.md "UI 변경 검증은 스크린샷 루프로 한다".
 *
 * renderer에는 각 단계마다 `engine:screenshotGoto` push로 "이 화면으로 가라"고
 * 지시한다(App.tsx가 구독 — onboarding 강제 표시/탭 전환/Apply 다이얼로그 오픈).
 *
 * 샌드박스 환경에서는 GPU 프로세스가 아예 뜨지 못해(ANGLE/EGL 초기화 실패)
 * capturePage()가 실패하거나 빈 이미지를 낼 수 있다 — 그 경우도 예외를 던지지
 * 않고 결과 배열에 실패로 기록한다(호출자가 그대로 로그·보고).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS, type ScreenshotRoute } from '../shared/ipc'

interface ScreenshotStep {
  readonly file: string
  readonly route: ScreenshotRoute
  /** 이 단계만 기본값(1200ms)보다 더 기다려야 하면 지정 — 기본은 undefined. */
  readonly delayMs?: number
}

/**
 * 순서 = 코디네이터 지시 순서(Onboarding·Differences·Candidates·Doctor·Settings·
 * Apply 다이얼로그). 'apply-dialog'는 App.tsx가 탭 전환 후 한 렌더 사이클을
 * 기다렸다가 다이얼로그 오픈 이벤트를 다시 쏘고(App.tsx 주석 참조), 그 오픈
 * 자체도 `engine:apply` dry-run(전 8개 capability diff+plan)이 끝나야 완료되므로
 * 다른 단계보다 넉넉히 더 기다린다.
 */
const SCREENSHOT_STEPS: readonly ScreenshotStep[] = [
  { file: '01-onboarding.png', route: 'onboarding' },
  { file: '02-differences.png', route: 'diff' },
  { file: '03-candidates.png', route: 'items' },
  { file: '04-doctor.png', route: 'doctor' },
  { file: '05-settings.png', route: 'settings' },
  { file: '06-apply-dialog.png', route: 'apply-dialog', delayMs: 9000 }
]

export interface ScreenshotResult {
  readonly file: string
  readonly ok: boolean
  readonly error?: string
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * `RIGSYNC_SCREENSHOT_DIR`가 있을 때 main/index.ts가 부르는 유일한 진입점.
 * 각 단계 사이에 렌더 대기 시간을 두고(리스트/다이얼로그 애니메이션·IPC 왕복
 * 여유), 실패한 단계가 있어도 나머지 단계는 계속 진행한다.
 */
export async function runScreenshotHarness(
  win: BrowserWindow,
  outDir: string
): Promise<ScreenshotResult[]> {
  fs.mkdirSync(outDir, { recursive: true })
  const results: ScreenshotResult[] = []

  for (const step of SCREENSHOT_STEPS) {
    try {
      win.webContents.send(IPC_CHANNELS.engineScreenshotGoto, step.route)
      await delay(step.delayMs ?? 1200)
      const image = await win.webContents.capturePage()
      const outPath = path.join(outDir, step.file)
      fs.writeFileSync(outPath, image.toPNG())
      const isEmpty = image.isEmpty()
      results.push({
        file: step.file,
        ok: !isEmpty,
        ...(isEmpty ? { error: 'capturePage()가 빈 이미지를 반환함(GPU 렌더 실패 가능성)' } : {})
      })
    } catch (err) {
      results.push({
        file: step.file,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return results
}
