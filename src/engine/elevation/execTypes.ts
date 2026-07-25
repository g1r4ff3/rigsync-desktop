/**
 * pkexec 프로세스 실행을 인터페이스 뒤로 격리한다(P2b 결정 ① —
 * `providers/linux/exec.ts` 패턴 재사용). `runSudoScript`는 이 인터페이스만
 * 알고, 실제 `child_process.spawn`은 `providers/linux/pkexec.ts`(dev 전용)가
 * 구현한다. 테스트는 fake를 주입해 실제 pkexec 없이도 스트리밍·파싱 경로
 * 전체를 검증한다.
 */

export interface ElevationSpawnOptions {
  readonly argv: readonly string[]
  /** stdout 청크가 도착할 때마다 호출 (임의 크기/정렬 — 줄바꿈 정렬 보장 없음). */
  readonly onStdout: (chunk: string) => void
  readonly timeoutMs: number
}

export interface ElevationSpawnResult {
  readonly code: number
  readonly stderr: string
}

export interface ElevationExec {
  spawn(options: ElevationSpawnOptions): Promise<ElevationSpawnResult>
}
