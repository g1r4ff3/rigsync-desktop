/**
 * 로그인 자동 시작(XDG autostart) — P4 트랙 4. Electron의
 * `app.setLoginItemSettings`는 Linux에서 지원되지 않으므로(문서화된 한계),
 * `~/.config/autostart/<id>.desktop` 파일을 직접 쓰고 지운다 — GNOME/KDE 등
 * 표준 데스크톱 환경이 부팅 시 이 디렉터리를 스캔하는 XDG Desktop Entry
 * Specification 표준 메커니즘이라 데스크톱 환경 무관하게 동작한다.
 *
 * `execPath`는 main(Electron)이 넘겨준다 — 어떤 실행파일을 자동 시작할지는
 * 패키징 형태(AppImage vs dev)에 따라 달라지는 electron 쪽 판단이라
 * 여기서는 그냥 문자열로 받는다(engine 순수성 유지).
 */
import fs from 'node:fs'
import path from 'node:path'

const DESKTOP_ENTRY_ID = 'rigsync-desktop.desktop'

export function autostartDesktopFilePath(homeDir: string): string {
  return path.join(homeDir, '.config', 'autostart', DESKTOP_ENTRY_ID)
}

export function isAutostartEnabled(homeDir: string): boolean {
  return fs.existsSync(autostartDesktopFilePath(homeDir))
}

function desktopEntryContent(execPath: string): string {
  return (
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=rigsync',
      'Comment=rigsync 트레이 상주 (drift 체크)',
      `Exec=${execPath}`,
      'X-GNOME-Autostart-enabled=true',
      'Terminal=false',
      'NoDisplay=false'
    ].join('\n') + '\n'
  )
}

export function enableAutostart(homeDir: string, execPath: string): void {
  const target = autostartDesktopFilePath(homeDir)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, desktopEntryContent(execPath))
}

export function disableAutostart(homeDir: string): void {
  const target = autostartDesktopFilePath(homeDir)
  if (fs.existsSync(target)) fs.unlinkSync(target)
}

/** 위저드/트레이 토글 한 진입점 — enabled 값에 따라 켜거나 끈다. */
export function setAutostart(homeDir: string, enabled: boolean, execPath: string): void {
  if (enabled) enableAutostart(homeDir, execPath)
  else disableAutostart(homeDir)
}
