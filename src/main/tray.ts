/**
 * 트레이 상주 — P3 "생각날 때 여는 도구 -> 상주 감시자" 승격의 UI 절반.
 * 판단(알림 여부)은 스케줄러/engine이 이미 끝낸 뒤 이 모듈은 그 결과를
 * 트레이 아이콘·툴팁·메뉴에 반영만 한다. 창 닫기=트레이로 숨김(앱 종료
 * 아님)이라는 계약은 `src/main/index.ts`가 `close` 이벤트를 가로채 구현하고,
 * 이 모듈은 "종료" 메뉴 클릭이 실제 `app.quit()`으로 이어지는 유일한 경로를
 * 제공한다.
 */
import { Menu, Tray, nativeImage } from 'electron'
import type { DriftSummary } from '../engine/drift'
import { trayIconDataUrl } from './trayIcon'

export interface TrayDeps {
  readonly showWindow: () => void
  readonly runCheckNow: () => Promise<void>
  readonly quit: () => void
  readonly getLastResult: () => DriftSummary | null
}

export interface AppTray {
  readonly tray: Tray
  /** 마지막 체크 결과가 바뀌었을 때(스케줄러 콜백 등에서) 툴팁·메뉴를 다시 그린다. */
  refresh(): void
  destroy(): void
}

function formatLastCheckLabel(last: DriftSummary | null): string {
  if (!last) return '마지막 확인: 아직 없음'
  const time = new Date(last.checkedAt).toLocaleTimeString()
  return `마지막 확인: ${time} — drift ${last.total}`
}

export function createAppTray(deps: TrayDeps): AppTray {
  const icon = nativeImage.createFromDataURL(trayIconDataUrl(22))
  const tray = new Tray(icon)

  function rebuild(): void {
    const last = deps.getLastResult()
    const label = formatLastCheckLabel(last)
    tray.setToolTip(label)
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '열기', click: () => deps.showWindow() },
        {
          label: '지금 확인',
          click: () => {
            void deps.runCheckNow().then(rebuild)
          }
        },
        { type: 'separator' },
        { label, enabled: false },
        { type: 'separator' },
        { label: '종료', click: () => deps.quit() }
      ])
    )
  }

  rebuild()
  // 좌클릭도 "열기"와 동일 — Linux/Windows 트레이 관례.
  tray.on('click', () => deps.showWindow())

  return {
    tray,
    refresh: rebuild,
    destroy: () => tray.destroy()
  }
}
