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
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증). fileMatches는 DoctorSystemProvider
    // 인터페이스상 plain sync라(providerTypes.ts) 감싸지 않는다.
    fileMatches: (expandedTarget: string) => state.fileMatches?.[expandedTarget] ?? [],
    isAptPackageInstalled: (pkg: string) => Promise.resolve(state.aptInstalled?.[pkg] ?? false),
    runShellCmd: (cmdString: string) =>
      Promise.resolve(state.shellResults?.[cmdString] ?? { code: 1, combinedOutput: '' })
  }
}

export interface FakeNvidiaState {
  readonly nvrmVersion?: string | null
  readonly packages?: readonly NvidiaDriverPackage[]
}

export function makeFakeNvidiaProvider(state: FakeNvidiaState = {}): NvidiaCheckProvider {
  return {
    // readNvrmVersion은 NvidiaCheckProvider 인터페이스상 plain sync라(nvidia.ts)
    // 감싸지 않는다.
    readNvrmVersion: () => state.nvrmVersion ?? null,
    listInstalledDriverPackages: () => Promise.resolve(state.packages ?? [])
  }
}
