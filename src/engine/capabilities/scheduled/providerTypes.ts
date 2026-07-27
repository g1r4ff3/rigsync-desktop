/**
 * perf 3라운드(providers 비동기화): 실제 crontab 호출 메서드는
 * `MaybePromise<T>`(`src/engine/async.ts`)를 돌려준다.
 */
import type { MaybePromise } from '../../async'

export interface CronCommandResult {
  readonly ok: boolean
  readonly output: string
}

export interface CronProvider {
  /** crontab이 PATH에 있는지 (없으면 이 capability는 skip 취급). */
  isAvailable(): boolean
  /** `crontab -l` — 사용자 crontab이 없으면 null(구 repo와 동일하게 "빈 문자열"과 구분). */
  readCrontab(): MaybePromise<string | null>
  /** `crontab -` (stdin으로 전체 내용 교체). */
  writeCrontab(content: string): MaybePromise<CronCommandResult>
}
