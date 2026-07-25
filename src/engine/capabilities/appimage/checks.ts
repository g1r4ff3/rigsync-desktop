/**
 * T3 선행 조건(doctor성) 체크 — 정책 §3.3/§8-D + FORWARD.md §7 실측:
 * Gear Lever 설치+≥4.6.2, libfuse2t64, AppImageLauncher 부재(있으면 충돌 경고).
 * 지금은 별도 doctor capability가 없어 이 capability 안의 함수로 둔다
 * (코디네이터 지시 — "doctor성 선행 조건 체크(지금은 capability 내 check 함수로)").
 */
import { MIN_GEARLEVER_VERSION } from './constants'
import type { AppimageSystemCheckProvider, GearLeverProvider } from './providerTypes'

export interface AppimagePreflightCheck {
  readonly gearLeverInstalled: boolean
  /** null = Gear Lever가 없거나 버전을 확인할 수 없음. */
  readonly gearLeverVersionOk: boolean | null
  readonly libfuse2t64Installed: boolean
  readonly appImageLauncherPresent: boolean
  readonly warnings: readonly string[]
}

/** "4.6.2" 같은 점-구분 버전 문자열 비교 (숫자 세그먼트별, 세그먼트 개수가 달라도 안전). */
export function versionAtLeast(version: string, min: string): boolean {
  const toParts = (v: string): number[] => v.split('.').map((seg) => Number.parseInt(seg, 10) || 0)
  const vp = toParts(version)
  const mp = toParts(min)
  const len = Math.max(vp.length, mp.length)
  for (let i = 0; i < len; i++) {
    const a = vp[i] ?? 0
    const b = mp[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return true
}

export function checkAppimagePreflight(
  provider: GearLeverProvider,
  systemCheck: AppimageSystemCheckProvider
): AppimagePreflightCheck {
  const gearLeverInstalled = provider.isAvailable()
  const version = gearLeverInstalled ? provider.version() : null
  const gearLeverVersionOk = version ? versionAtLeast(version, MIN_GEARLEVER_VERSION) : null

  const libfuse2t64Installed = systemCheck.isPackageInstalled('libfuse2t64')
  const appImageLauncherPresent = systemCheck.isPackageInstalled('appimagelauncher')

  const warnings: string[] = []
  if (!gearLeverInstalled) {
    warnings.push(
      'Gear Lever(it.mijorus.gearlever)가 설치돼 있지 않음 -- ' +
        'flatpak install flathub it.mijorus.gearlever'
    )
  } else if (gearLeverVersionOk === false) {
    warnings.push(
      `Gear Lever 버전이 ${MIN_GEARLEVER_VERSION} 미만 -- 업그레이드 필요(%F/%U 임포트 크래시 수정 전)`
    )
  }
  if (!libfuse2t64Installed) {
    warnings.push('libfuse2t64 미설치 -- 일부 구형 AppImage가 이 라이브러리를 요구할 수 있음')
  }
  if (appImageLauncherPresent) {
    warnings.push('AppImageLauncher가 설치돼 있음 -- Gear Lever와 충돌 가능, 제거를 권장')
  }

  return {
    gearLeverInstalled,
    gearLeverVersionOk,
    libfuse2t64Installed,
    appImageLauncherPresent,
    warnings
  }
}
