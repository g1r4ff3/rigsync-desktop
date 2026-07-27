/**
 * repos capability가 git을 조회/실행하는 유일한 통로 (디렉터리 스캔 자체는
 * ctx.settings.repoScanDirs가 ctx.homeDir 기준 상대경로라 이미 테스트-안전한
 * 실제 fs 호출로 한다 — dotfiles capture와 동일한 판단, providerTypes.ts 밖).
 *
 * perf 3라운드(providers 비동기화): 실제 git 호출 메서드는
 * `MaybePromise<T>`(`src/engine/async.ts`)를 돌려준다.
 */
import type { MaybePromise } from '../../async'

export interface GitCommandResult {
  readonly ok: boolean
  readonly output: string
}

export interface GitProvider {
  /** `git -C <path> config --get remote.origin.url` (없으면 빈 문자열). */
  remoteUrl(absPath: string): MaybePromise<string>
  /** `git -C <path> symbolic-ref --short HEAD` (없으면 빈 문자열). */
  branch(absPath: string): MaybePromise<string>
  /** `git clone <url> <dest>`. */
  clone(url: string, dest: string): MaybePromise<GitCommandResult>
}
