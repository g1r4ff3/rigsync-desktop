/**
 * fonts doctor 체크 3종(코디네이터 지시):
 * ① manifest에 선언됐는데 이 머신에 설치되지 않은 폰트
 * ② 설치돼 있지만 소스 미지정이라 다른 머신에서 재현 불가한 폰트
 * ③ fc-cache/fc-list 사용 가능 여부
 *
 * appimage/checks.ts와 동일한 원칙으로 순수 sync 함수다 — buildDoctorReport
 * (doctor/report.ts) 자체가 sync라 여기도 diff를 미리 계산해 인자로 받는다
 * (diffFonts는 다른 diff 함수들과의 시그니처 통일을 위해 nominal async지만
 * 내부는 순수 fs 동기 로직이라 이미 계산된 결과를 그대로 재사용해도 안전).
 */
import type { FontsDiffReport } from './types'
import type { FontsSystemProvider } from './providerTypes'
import { groupInstalledFontFiles } from './scan'
import type { RigsyncContext } from '../../context'

export interface FontsPreflightCheck {
  /** manifest에 선언됐지만 이 머신에 설치되지 않은 폰트 이름(diff.toInstall 그대로). */
  readonly missingInstalled: readonly string[]
  /** 설치돼 있지만 알려진 레지스트리에 없어 재현 불가능한 파일명. */
  readonly unresolvedInstalled: readonly string[]
  readonly fcCacheAvailable: boolean
  readonly fcListAvailable: boolean
  readonly warnings: readonly string[]
}

export function checkFontsPreflight(
  ctx: Pick<RigsyncContext, 'homeDir'>,
  diff: FontsDiffReport,
  systemProvider: FontsSystemProvider
): FontsPreflightCheck {
  const { unresolvedFiles } = groupInstalledFontFiles(ctx)
  const fcCacheAvailable = systemProvider.fcCacheAvailable()
  const fcListAvailable = systemProvider.fcListAvailable()

  const warnings: string[] = []
  for (const name of diff.toInstall) {
    warnings.push(
      `${name}: manifest에 선언됐지만 이 머신에 설치되지 않음 -- Apply로 설치할 수 있습니다`
    )
  }
  for (const file of unresolvedFiles) {
    warnings.push(
      `${file}: 설치돼 있지만 알려진 레지스트리에 없어 다른 머신에서 재현할 수 없습니다 -- ` +
        'manifest에 source를 지정해야 합니다'
    )
  }
  if (!fcCacheAvailable) {
    warnings.push('fc-cache 명령을 찾을 수 없음 -- fontconfig 패키지 설치 필요')
  }
  if (!fcListAvailable) {
    warnings.push('fc-list 명령을 찾을 수 없음 -- fontconfig 패키지 설치 필요')
  }

  return {
    missingInstalled: diff.toInstall,
    unresolvedInstalled: unresolvedFiles,
    fcCacheAvailable,
    fcListAvailable,
    warnings
  }
}
