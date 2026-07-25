/**
 * 실제 dpkg 패키지 설치 여부 조회 — appimage capability의 doctor성 선행 조건
 * 체크(libfuse2t64/AppImageLauncher)가 쓴다.
 */
import type { AppimageSystemCheckProvider } from '../../capabilities/appimage/providerTypes'
import { run } from './exec'

export class DpkgSystemCheckProvider implements AppimageSystemCheckProvider {
  isPackageInstalled(debPackageName: string): boolean {
    const result = run(['dpkg', '-s', debPackageName])
    return result.code === 0
  }
}
