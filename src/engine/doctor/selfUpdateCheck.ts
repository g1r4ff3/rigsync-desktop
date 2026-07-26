/**
 * "자동 업데이트(자기 자신)" doctor 체크 — 실사용 결함 수정: 사용자가 AppImage를
 * Gear Lever로 통합해도 `[UpdatesNotAvailable]`로 남아 업데이트를 못 받았다
 * (README "Gear Lever로" 설치 안내에도 `--set-update-source` 단계가 없었다).
 *
 * 이 체크는 rigsync 자기 자신의 AppImage가 Gear Lever에 통합돼 있고 GitHub
 * 업데이트 소스(`g1r4ff3/rigsync-desktop`)가 지정돼 있는지만 본다 — T3
 * capability(`capabilities/appimage/checks.ts`의 `checkAppimagePreflight`)가
 * 이미 다루는 "Gear Lever 자체가 쓸 만한가"(설치·버전·libfuse2t64)와는 다른
 * 질문이다. dev(`npm run dev`)·deb 설치는 AppImage가 아니므로 `applicable:
 * false`로 조용히 통과시킨다(코디네이터 지시).
 *
 * `src/main/selfUpdate.ts`(런타임 자기 등록, 이 체크와 별개 — 등록은 "고치는"
 * 쪽이고 이 체크는 "보여주는" 쪽)와 같은 3층 문제의 두 축이다: 다음 릴리스부터는
 * 빌드 시 embed(`scripts/embed-appimage-update-info.mjs`)로 처음부터 인식되고,
 * 이미 설치된 구버전은 런타임 자기 등록이 구제하며, 그마저 실패했을 때 이
 * 체크가 안전 불변식 ⑥ 정신(조치 가능한 명령 전문 노출)으로 마지막 안내를 준다.
 */
import type { GearLeverAppConfig } from '../capabilities/appimage/providerTypes'

export type SelfUpdateStatusCode =
  'not-appimage' | 'gearlever-missing' | 'not-integrated' | 'source-missing' | 'configured'

export interface SelfUpdateCheckInput {
  /** `process.env.APPIMAGE` — AppImage 실행이 아니면 null(dev/deb, 해당 없음). */
  readonly appImagePath: string | null
  /** T3 preflight(`checkAppimagePreflight`)가 이미 판정한 값 재사용 — 중복 조회 안 함. */
  readonly gearLeverInstalled: boolean
  /** `gearLeverProvider.readAppConfig(appImagePath)` 결과 — 통합 안 됐으면 null. */
  readonly appConfig: GearLeverAppConfig | null
}

export interface SelfUpdateCheck {
  /** false면 dev/deb 실행 — doctor 화면에서 이 항목 자체를 조용히 숨긴다. */
  readonly applicable: boolean
  readonly status: SelfUpdateStatusCode
  readonly warning?: string
  /** 미설정일 때 사용자가 그대로 복붙 실행할 수 있는 수동 명령 전문(안전 불변식 ⑥). */
  readonly manualCommand?: string
}

/** README·Doctor·런타임 자기 등록이 공유하는 좌표 상수 — 값이 갈리면 서로 다른 걸 가리키게 된다. */
export const SELF_UPDATE_SOURCE_OWNER = 'g1r4ff3'
export const SELF_UPDATE_SOURCE_REPO = 'rigsync-desktop'
export const SELF_UPDATE_REPO_FILENAME_GLOB = 'rigsync-desktop-*.AppImage'

/** Doctor·README가 그대로 노출하는 수동 명령 전문. */
export function selfUpdateManualCommand(appImagePath: string): string {
  return (
    `flatpak run it.mijorus.gearlever --set-update-source "${appImagePath}" --manager GithubUpdater ` +
    `repo=${SELF_UPDATE_SOURCE_OWNER}/${SELF_UPDATE_SOURCE_REPO} ` +
    `repo_filename='${SELF_UPDATE_REPO_FILENAME_GLOB}' allow_prereleases=false`
  )
}

export function checkSelfUpdateStatus(input: SelfUpdateCheckInput): SelfUpdateCheck {
  if (!input.appImagePath) {
    return { applicable: false, status: 'not-appimage' }
  }

  if (!input.gearLeverInstalled) {
    return {
      applicable: true,
      status: 'gearlever-missing',
      warning: 'Gear Lever가 설치돼 있지 않아 자동 업데이트 소스를 확인할 수 없습니다.'
    }
  }

  if (!input.appConfig) {
    return {
      applicable: true,
      status: 'not-integrated',
      warning:
        '이 AppImage가 Gear Lever에 통합돼 있지 않습니다 -- Gear Lever를 열어 이 파일을 통합(Integrate)하세요.'
    }
  }

  if (!input.appConfig.updateManager?.repo) {
    const manualCommand = selfUpdateManualCommand(input.appImagePath)
    return {
      applicable: true,
      status: 'source-missing',
      warning: `자동 업데이트 소스가 지정되지 않았습니다 -- 다음 명령을 실행하세요: ${manualCommand}`,
      manualCommand
    }
  }

  return { applicable: true, status: 'configured' }
}
