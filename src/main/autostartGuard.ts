/**
 * dev 모드에서 autostart 활성화를 막는 얇은 가드.
 *
 * 배경: `resolveExecPath()`(src/main/index.ts)는 AppImage 실행 중이면
 * `$APPIMAGE`(마운트 전 원본 경로)를, 아니면 `process.execPath`로 폴백한다.
 * dev 모드(`npm run dev`)에서는 이 폴백이 `node_modules/electron/dist/electron`
 * 같은 개발용 바이너리 경로가 되는데, 이 경로가 `~/.config/autostart/*.desktop`
 * `Exec=`에 그대로 박히면 다음 로그인 때 존재하지 않거나(패키지 재설치 후
 * 삭제) 의미 없는 경로가 실행돼 "로그인 시 깨진 자동시작"이 된다.
 *
 * `isDev`를 주입받는 순수 함수로 둔 이유: electron이나
 * `@electron-toolkit/utils`의 `is.dev`를 여기서 직접 import하면 이 파일이
 * Electron 런타임 없이는 테스트할 수 없어진다 — 호출부(main/index.ts,
 * main/ipc.ts, main/onboarding.ts)가 `is.dev`를 읽어 넘겨주고, 이 파일은 그
 * 값만 가지고 판단한다(src/main/scheduler.ts가 실제 타이머 대신 delay를
 * 주입받는 것과 같은 결의 결정).
 *
 * 비활성화(enabled=false)는 항상 안전하므로 dev 여부와 무관하게 통과시킨다
 * — 막을 이유가 있는 것은 "존재하지 않을 dev 경로를 등록하는" enable 쪽뿐.
 */
import { setAutostart } from '../engine/autostart'

export function shouldBlockAutostartEnable(isDev: boolean, enabled: boolean): boolean {
  return enabled && isDev
}

export function guardedSetAutostart(
  homeDir: string,
  enabled: boolean,
  execPath: string,
  isDev: boolean
): void {
  if (shouldBlockAutostartEnable(isDev, enabled)) {
    console.warn(
      '[autostart] dev 모드에서는 autostart를 활성화하지 않습니다 ' +
        `(execPath=${execPath}가 패키지 산출물이 아니라 dev 실행 경로일 수 있음).`
    )
    return
  }
  setAutostart(homeDir, enabled, execPath)
}
