/**
 * settings capability가 dconf를 조회/적용하는 유일한 통로 — P2a 결정 ⑥과 동일한
 * 원칙("provider 인터페이스 뒤로 시스템 호출 격리"). 실제 구현은
 * `src/engine/providers/linux/dconf.ts`.
 */

export interface DconfCommandResult {
  readonly ok: boolean
  readonly output: string
}

export interface DconfProvider {
  /** dconf가 PATH에 있는지 (없으면 이 capability는 skip 취급). */
  isAvailable(): boolean
  /** `dconf dump <path>` — 없거나 빈 경로면 빈 문자열. */
  dump(path: string): string
  /** `dconf load <path>` (stdin으로 데이터 전달). */
  load(path: string, data: string): DconfCommandResult
}
