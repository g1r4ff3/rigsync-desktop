/**
 * 구 `~/repos/rigsync` manifest 마이그레이션 리포트 타입. 구 repo는
 * **읽기 전용**으로만 다룬다 — 어떤 함수도 legacyRepoPath 아래에 쓰지 않는다.
 */

export type LegacyMigrationAction = 'migrated' | 'reported-only' | 'skipped'

export interface LegacyMigrationItem {
  readonly capability: string
  readonly action: LegacyMigrationAction
  /** 사람이 읽는 요약 (예: "packages 158개, sources 6개, keyrings 2개"). */
  readonly detail: string
}

export interface LegacyMigrationSummary {
  readonly dryRun: boolean
  readonly legacyRepoPath: string
  readonly items: readonly LegacyMigrationItem[]
  readonly warnings: readonly string[]
}
