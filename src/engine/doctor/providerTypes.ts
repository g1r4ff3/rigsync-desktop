/**
 * doctor의 hand-maintained checks 레이어(file/apt/cmd 타입)가 시스템을 조회하는
 * 유일한 통로 — P2a 결정 ⑥과 동일한 원칙. 실제 구현은
 * `src/engine/providers/linux/doctorSystem.ts`.
 */

export interface ShellCheckResult {
  readonly code: number
  readonly combinedOutput: string
}

export interface DoctorSystemProvider {
  /** 이미 `~` 확장된 절대 패턴에 매칭되는 파일 목록 (구 repo `glob.glob`). */
  fileMatches(expandedTarget: string): string[]
  /** `dpkg -s <pkg>` 성공 여부. */
  isAptPackageInstalled(pkg: string): boolean
  /** 임의 셸 명령 한 줄을 실행하고 종료코드+표준출력·에러 합본을 돌려준다. */
  runShellCmd(cmdString: string): ShellCheckResult
}
