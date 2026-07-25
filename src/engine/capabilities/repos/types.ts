/**
 * repos(git clone/pull) 레이어 manifest 스키마 + capture/diff 리포트 타입. 구 repo
 * `capture_repos`/`diff_repos`/`plan_repos`(rigsync.py:1680-1753) 행동을 옮긴 것
 * (코드 복사 아님).
 */

export interface RepoEntry {
  /** `~` 축약 경로 (contractHome 결과). */
  readonly path: string
  readonly url: string
  readonly branch: string
}

export interface ReposManifest {
  readonly repo?: readonly RepoEntry[]
}

export interface ReposCaptureReport {
  readonly found: number
  readonly captured: number
  readonly added: number
  readonly warnings: readonly string[]
  readonly notes: readonly string[]
}

export interface ReposDiffReport {
  readonly toClone: readonly RepoEntry[]
  readonly manualNoUrl: readonly string[]
}
