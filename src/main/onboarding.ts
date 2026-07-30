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
import { selectModeCommitMessage } from '../engine/authoredWriteMessage'
import { defaultManifestDir, writeConfigFile, type RigsyncContext } from '../engine/context'
import { setSelectionMode } from '../engine/selection'
import { cloneManifestRepo, cloneErrorGuidance } from '../engine/transport'
import type { GitTransportProvider } from '../engine/transport'
import { guardedSetAutostart } from './autostartGuard'
import { autoSyncAfterAuthoredWrite } from './gitSync'
import type { CompleteOnboardingRequest, SelectionMode } from '../shared/ipc'

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

/**
 * WS7("창고 모델 1차" — cheerful-growing-fairy 계획) 온보딩 구독 모드 스텝 —
 * `completeOnboarding`(config.toml 저장)이 끝난 **뒤**, `refreshContext()`로
 * 새 ctx가 이미 반영된 상태에서 호출해야 한다(engineWorker.ts
 * `handlers.completeOnboarding` 참조 — 새로 만들어진/클론된 manifestDir을
 * ctx가 가리켜야 selection.toml이 올바른 위치에 쓰인다).
 *
 * select가 아니면(생략 또는 'all') 아무것도 쓰지 않는다 — selection.toml
 * 파일 부재 자체가 'all' 무마이그레이션 계약이라, 굳이 mode='all'을 명시
 * 기록할 이유가 없다. select면 로컬에 mode='select'를 쓰고(항상 성공 —
 * 순수 fs 쓰기) fire-and-forget으로 commit+push를 시도한다: **push 실패해도
 * 온보딩 자체는 막지 않는다**(계획서 지시) — 실패는 기존
 * `getLastSyncStatus()` 표면화 경로로 나중에 드러난다. manifestDir이 아직
 * git repo가 아니어도(manifestSource='new') `syncAuthoredWrite`가
 * 'local-only'로 조용히 끝난다(engine/transport/sync.ts — 에러가 아니다).
 */
export function applyOnboardingSelectionMode(
  ctx: RigsyncContext,
  selectionMode: SelectionMode | undefined,
  gitTransportProvider: GitTransportProvider
): void {
  if (selectionMode !== 'select') return
  setSelectionMode(ctx, 'select')
  autoSyncAfterAuthoredWrite(
    ctx,
    gitTransportProvider,
    selectModeCommitMessage(ctx.machineId, 'select')
  )
}
