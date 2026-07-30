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
  { file: '06-apply-dialog.png', route: 'apply-dialog', delayMs: 9000 },
  // 실사용 결함 수정 검증용 -- 온보딩 "저장소에서 클론" 탭이 미리 선택된 화면.
  // 06(apply-dialog) 다음에 둬 forceOnboarding이 false->true로 실제 전환되게
  // 한다(App.tsx가 이 전환에서만 OnboardingView를 다시 마운트해 preset이 먹는다).
  { file: '07-onboarding-clone.png', route: 'onboarding-clone' },
  // 항목 삭제(uninstall) 검증용 — 삭제 확인 다이얼로그(apt 의존성 경고 포함)와
  // 일괄 삭제 체크리스트. planUninstall dry-run은 apply보다 훨씬 가벼워
  // (capability 하나·항목 소수) 9000ms까지는 필요 없지만 여유를 둔다. 기존
  // 01~07 파일명은 그대로 두고 새 화면이라 08/09로 이어 붙인다.
  // refactor-spec-v0.2 §1 검증용 — apt "배포판 기본" 접힌 그룹은 목록 하단이라
  // 기본 스크린샷(03)엔 안 잡힌다. 그룹 헤더로 스크롤한 접힌 상태(10)와
  // 펼친 상태(11)를 캡처한다. **다이얼로그 단계(08/09)보다 먼저 실행해야
  // 한다** — 실측(2026-07-27): GPU 비활성 캡처 모드에서 Radix 모달이 한 번
  // 뜨면 그 뒤 리페인트가 멈춰(상태는 닫혔는데 픽셀이 이전 프레임에 고정)
  // 이후 목록 캡처가 전부 다이얼로그 잔상으로 나온다. 파일명 번호는 촬영
  // 순서가 아니라 화면 정체성이므로 그대로 둔다.
  // 10은 직전 단계(온보딩)에서 탭이 재마운트된 직후라 listSyncItems 전체
  // (apt 분류 조회 포함)를 다시 기다려야 한다 — 넉넉히 둔다.
  { file: '10-candidates-distro.png', route: 'items-distro', delayMs: 6000 },
  { file: '11-candidates-distro-open.png', route: 'items-distro-open', delayMs: 2000 },
  { file: '08-candidates-delete-confirm.png', route: 'items-delete-confirm', delayMs: 3000 },
  { file: '09-candidates-bulk-delete.png', route: 'items-bulk-delete', delayMs: 1500 },
  // WS6("창고 모델 1차") 검증용 — dotfiles "Add file/folder" 다이얼로그. 08/09와
  // 같은 이유로(Radix 모달이 뜨면 그 뒤 리페인트가 멈추는 캡처 모드 함정, 위
  // 주석 참조) 다이얼로그를 여는 단계들의 맨 끝에 둔다.
  { file: '12-candidates-register-dotfile.png', route: 'items-register-dotfile', delayMs: 1500 }
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
      // 실측(2026-07-27): GPU 비활성 모드에서 compositor가 상태 변경(다이얼로그
      // 닫힘·스크롤)을 새 프레임으로 커밋하지 않아 capturePage()가 이전 프레임을
      // 돌려주는 경우가 있다 — 캡처 직전에 강제 리페인트를 요청하고 한 박자
      // 기다린다.
      win.webContents.invalidate()
      await delay(300)
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
