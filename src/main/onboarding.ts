/**
 * 온보딩 위저드 "배선" — config.toml 쓰기는
 * `src/engine/context.ts`(`writeConfigFile`), 여기는 요청 파싱 + 순서 조립만
 * 한다: manifestDir 준비(new: mkdir / existing: 그대로 / clone: git clone) ->
 * config.toml 쓰기 -> autostart 반영.
 *
 * R2: 구 rigsync 마이그레이션 기능은 제거됐다(사용자 결정 — "fresh capture로
 * 충분"). manifestSource는 'new'|'existing'|'clone' 3택 (clone은 실사용 결함
 * 수정 — follower의 정상 진입 경로).
 *
 * 클론 실패 시 **config를 쓰지 않고 예외를 던진다** — 호출자(main/ipc.ts의
 * ipcMain.handle)가 그대로 rejected promise로 renderer에 전달하고,
 * OnboardingView는 catch해서 에러 메시지를 보여주며 온보딩 폼에 머문다
 * (완료 콜백을 안 부르므로 다음 화면으로 안 넘어간다).
 */
import fs from 'node:fs'
import path from 'node:path'
import { defaultManifestDir, writeConfigFile } from '../engine/context'
import { cloneManifestRepo, cloneErrorGuidance } from '../engine/transport'
import type { GitTransportProvider } from '../engine/transport'
import { guardedSetAutostart } from './autostartGuard'
import type { CompleteOnboardingRequest } from '../shared/ipc'

export interface CompleteOnboardingDeps {
  readonly homeDir: string
  readonly execPath: string
  /** dev 모드(`is.dev`)면 autostart 활성화를 막는다 — autostartGuard.ts 참조. */
  readonly isDev: boolean
  /** manifestSource==='clone'일 때만 쓰인다. */
  readonly gitTransportProvider: Pick<GitTransportProvider, 'cloneManifest'>
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

  if (request.manifestSource === 'clone') {
    const repoUrl = request.repoUrl?.trim()
    if (!repoUrl) {
      throw new Error('저장소 URL을 입력하세요')
    }
    const result = await cloneManifestRepo(repoUrl, manifestDir, deps.gitTransportProvider)
    if (!result.ok) {
      // 실패하면 config를 쓰지 않고 여기서 던진다 -- 온보딩은 그대로 머문다.
      throw new Error(cloneErrorGuidance(result.error))
    }
  } else {
    fs.mkdirSync(manifestDir, { recursive: true })
  }

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
