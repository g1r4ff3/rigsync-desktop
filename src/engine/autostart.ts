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

/**
 * 기존 .desktop 파일의 `Exec=` 값을 읽는다 — self-heal이 "지금 등록된 경로가
 * 맞는지"를 판단하는 유일한 근거. 파일이 없거나 `Exec=` 줄이 없으면 null
 * (isAutostartEnabled와 같은 존재 여부 판정을 다시 하지 않는다 — 호출부가
 * 그건 이미 알고 있다는 전제).
 */
export function readAutostartExecPath(homeDir: string): string | null {
  const target = autostartDesktopFilePath(homeDir)
  if (!fs.existsSync(target)) return null
  const content = fs.readFileSync(target, 'utf-8')
  const match = /^Exec=(.*)$/m.exec(content)
  return match ? match[1] : null
}

export interface AutostartSelfHealResult {
  readonly healed: boolean
  /** healed일 때만 채워지는, 재작성 전 Exec 값(로그용). */
  readonly staleExecPath?: string
}

/**
 * v0.1.20: 패키지 모드(비-dev) 기동 시 stale Exec 경로를 자동 치유한다 —
 * 2026-07-29 실사고("Capture를 눌러도 반영이 안 되는 것처럼 보였다") 조사
 * 과정에서 발견된 별개 위험의 재발 방지책. AppImage가 다른 경로로 이동되거나
 * (Gear Lever 통합·재설치 등), 한때 `npm run dev`로 autostart를 켰다가 그
 * 개발용 실행 경로가 `.desktop`의 Exec=에 그대로 남으면, 다음 로그인 때
 * 존재하지 않거나 뜻이 다른 경로가 실행돼("로그인 시 깨진 자동시작") 트레이
 * 상주 drift 체크가 조용히 멈춘다.
 *
 * dev 모드에서는 아무것도 하지 않는다(autostartGuard.ts와 같은 이유 — dev
 * 실행 경로 자체가 안정적인 참조점이 아니다). autostart가 꺼져 있으면
 * (.desktop 파일이 없으면) 치유할 대상이 없으므로 역시 아무것도 하지 않는다
 * (자동으로 켜지 않는다 — 사용자가 명시적으로 껐거나 애초에 켠 적이 없는
 * 상태를 이 함수가 바꾸지 않는다).
 */
export function selfHealAutostart(
  homeDir: string,
  execPath: string,
  isDev: boolean
): AutostartSelfHealResult {
  if (isDev) return { healed: false }
  if (!isAutostartEnabled(homeDir)) return { healed: false }
  const current = readAutostartExecPath(homeDir)
  if (current === execPath) return { healed: false }
  enableAutostart(homeDir, execPath)
  return { healed: true, staleExecPath: current ?? undefined }
}
