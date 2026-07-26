/**
 * 온보딩 위저드 "배선" — config.toml 쓰기는
 * `src/engine/context.ts`(`writeConfigFile`), 여기는 요청 파싱 + 순서 조립만
 * 한다: manifestDir 준비 -> config.toml 쓰기 -> autostart 반영.
 *
 * R2: 구 rigsync 마이그레이션 기능은 제거됐다(사용자 결정 — "fresh capture로
 * 충분"). manifestSource는 'new'|'existing' 2택만 남는다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { defaultManifestDir, writeConfigFile } from '../engine/context'
import { guardedSetAutostart } from './autostartGuard'
import type { CompleteOnboardingRequest } from '../shared/ipc'

export interface CompleteOnboardingDeps {
  readonly homeDir: string
  readonly execPath: string
  /** dev 모드(`is.dev`)면 autostart 활성화를 막는다 — autostartGuard.ts 참조. */
  readonly isDev: boolean
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
): Promise<void> {
  const manifestDir = expandTilde(request.manifestDir, deps.homeDir)
  fs.mkdirSync(manifestDir, { recursive: true })

  writeConfigFile(deps.homeDir, {
    machineId: request.machineId,
    role: request.role,
    manifestDir,
    autostartEnabled: request.autostartEnabled,
    ...(request.profile ? { profile: request.profile } : {})
  })

  guardedSetAutostart(deps.homeDir, request.autostartEnabled, deps.execPath, deps.isDev)
}

/** manifestSource==='new'일 때 위저드가 제안하는 기본 manifestDir. */
export function suggestNewManifestDir(homeDir: string): string {
  return defaultManifestDir(homeDir)
}
