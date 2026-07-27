/**
 * settings capability가 dconf를 조회/적용하는 유일한 통로 — P2a 결정 ⑥과 동일한
 * 원칙("provider 인터페이스 뒤로 시스템 호출 격리"). 실제 구현은
 * `src/engine/providers/linux/dconf.ts`.
 *
 * perf 3라운드(providers 비동기화): 실제 dconf 호출 메서드는
 * `MaybePromise<T>`(`src/engine/async.ts`)를 돌려준다.
 */
import type { MaybePromise } from '../../async'

export interface DconfCommandResult {
  readonly ok: boolean
  readonly output: string
}

export interface DconfProvider {
  /** dconf가 PATH에 있는지 (없으면 이 capability는 skip 취급). */
  isAvailable(): boolean
  /** `dconf dump <path>` — 없거나 빈 경로면 빈 문자열. */
  dump(path: string): MaybePromise<string>
  /** `dconf load <path>` (stdin으로 데이터 전달). */
  load(path: string, data: string): MaybePromise<DconfCommandResult>
}
