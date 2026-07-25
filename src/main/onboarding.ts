/**
 * 온보딩 위저드 "배선" — 판단(마이그레이션 매핑)은
 * `src/engine/migration/legacy.ts`, config.toml 쓰기는
 * `src/engine/context.ts`(`writeConfigFile`), 여기는 요청 파싱 + 순서 조립만
 * 한다: (필요시) manifestDir 준비 -> (필요시) 마이그레이션 실행 -> config.toml
 * 쓰기 -> autostart 반영 -> 컨텍스트/스케줄러 갱신.
 */
import fs from 'node:fs'
import path from 'node:path'
import { migrateLegacyManifest } from '../engine/migration/legacy'
import type { LegacyMigrationSummary } from '../engine/migration/types'
import { defaultManifestDir, writeConfigFile, type RigsyncContext } from '../engine/context'
import { setAutostart } from '../engine/autostart'
import type { CompleteOnboardingRequest } from '../shared/ipc'

export interface CompleteOnboardingDeps {
  readonly homeDir: string
  readonly execPath: string
}

/** 위저드 텍스트 입력은 `~/...` 축약형을 그대로 받을 수 있다 -- fs는 이를 모르므로 여기서 편다. */
export function expandTilde(inputPath: string, homeDir: string): string {
  if (inputPath === '~') return homeDir
  if (inputPath.startsWith('~/')) return path.join(homeDir, inputPath.slice(2))
  return inputPath
}

export async function completeOnboarding(
  request: CompleteOnboardingRequest,
  deps: CompleteOnboardingDeps
): Promise<{ migration?: LegacyMigrationSummary }> {
  const manifestDir = expandTilde(request.manifestDir, deps.homeDir)
  fs.mkdirSync(manifestDir, { recursive: true })

  let migration: LegacyMigrationSummary | undefined
  if (request.manifestSource === 'migrate') {
    if (!request.legacyRepoPath) {
      throw new Error('manifestSource=migrate인데 legacyRepoPath가 없음')
    }
    // 마이그레이션이 쓰는 ctx는 manifestDir/machineId 두 필드만 실제로 쓰인다
    // (legacy.ts 참조) -- 아직 온보딩 완료 전이라 role 등 나머지는 임시값으로 채운다.
    const migrationCtx: RigsyncContext = {
      machineId: request.machineId,
      role: request.role,
      manifestDir,
      homeDir: deps.homeDir,
      backupRoot: `${deps.homeDir}/.rigsync-backup`,
      aptBaselinePath: `${deps.homeDir}/.local/share/rigsync-desktop/apt-baseline.txt`,
      settings: {},
      autostartEnabled: false
    }
    const legacyRepoPath = expandTilde(request.legacyRepoPath, deps.homeDir)
    migration = await migrateLegacyManifest(migrationCtx, legacyRepoPath, { dryRun: false })
  }

  writeConfigFile(deps.homeDir, {
    machineId: request.machineId,
    role: request.role,
    manifestDir,
    autostartEnabled: request.autostartEnabled,
    ...(request.profile ? { profile: request.profile } : {})
  })

  setAutostart(deps.homeDir, request.autostartEnabled, deps.execPath)

  return { migration }
}

/** manifestSource==='new'일 때 위저드가 제안하는 기본 manifestDir. */
export function suggestNewManifestDir(homeDir: string): string {
  return defaultManifestDir(homeDir)
}
