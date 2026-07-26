import type { NvidiaCheckProvider, NvidiaDriverPackage } from './nvidia'
import type { ShellCheckResult, DoctorSystemProvider } from './providerTypes'

// fonts doctor 체크의 fake provider는 capability 쪽 testHelpers를 그대로
// 재사용한다(중복 정의 방지) — doctor/report.test.ts가 이 모듈 하나만
// import하면 되도록 여기서 재수출한다.
export { makeFakeFontsSystemProvider } from '../capabilities/fonts/testHelpers'

export interface FakeDoctorSystemState {
  /** expandedTarget -> 매칭 결과. 없으면 빈 배열. */
  fileMatches?: Record<string, string[]>
  /** 패키지명 -> 설치 여부. */
  aptInstalled?: Record<string, boolean>
  /** 명령 문자열 -> 결과. */
  shellResults?: Record<string, ShellCheckResult>
}

export function makeFakeDoctorSystemProvider(
  state: FakeDoctorSystemState = {}
): DoctorSystemProvider {
  return {
    fileMatches: (expandedTarget: string) => state.fileMatches?.[expandedTarget] ?? [],
    isAptPackageInstalled: (pkg: string) => state.aptInstalled?.[pkg] ?? false,
    runShellCmd: (cmdString: string) =>
      state.shellResults?.[cmdString] ?? { code: 1, combinedOutput: '' }
  }
}

export interface FakeNvidiaState {
  readonly nvrmVersion?: string | null
  readonly packages?: readonly NvidiaDriverPackage[]
}

export function makeFakeNvidiaProvider(state: FakeNvidiaState = {}): NvidiaCheckProvider {
  return {
    readNvrmVersion: () => state.nvrmVersion ?? null,
    listInstalledDriverPackages: () => state.packages ?? []
  }
}
