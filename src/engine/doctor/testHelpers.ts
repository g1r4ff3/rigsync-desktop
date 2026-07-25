import type { ShellCheckResult, DoctorSystemProvider } from './providerTypes'

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
