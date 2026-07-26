/**
 * 런타임 자기 등록 — 빌드 시 embed(`scripts/embed-appimage-update-info.mjs`)는
 * *다음* 릴리스부터만 효과가 있다. 이미 설치돼 있는(embed 없는) 구버전
 * AppImage를 구제하려고, 앱이 뜰 때 조건이 맞으면 자기 자신을 Gear Lever
 * 업데이트 소스로 한 번 등록한다 (실사용 결함: 통합만으로는 소스가 지정되지
 * 않아 `[UpdatesNotAvailable]`로 남았다).
 *
 * `src/main/scheduler.ts`/`autostartGuard.ts`와 같은 결의 분업 — 판단
 * (`decideSelfRegistration`)은 electron을 전혀 import하지 않는 순수 함수라
 * fake 주입으로 유닛 테스트되고, 실제 I/O(Gear Lever CLI 호출·상태 파일
 * 읽기/쓰기)는 `attemptSelfUpdateRegistration`이 주입받은 deps 뒤에 있다.
 *
 * 안전조건 (코디네이터 명세):
 * - AppImage 실행 중(`$APPIMAGE`)일 때만 — dev/deb은 해당 없음.
 * - Gear Lever가 실제로 쓸 수 있을 때만(`isAvailable()`).
 * - **오직 자기 자신에게만** — `appImagePath`는 항상 `$APPIMAGE`(자기 경로)
 *   그대로이고, 다른 AppImage 경로를 받거나 조회하는 경로는 없다.
 * - 자기 항목에 소스가 이미 있으면 건드리지 않는다(embed된 최신 빌드·수동
 *   설정을 덮어쓰지 않음).
 * - **한 번 시도하면(성공/실패 무관) 상태 파일에 기록하고 다시 시도하지
 *   않는다** — 사용자가 Gear Lever에서 소스를 일부러 지웠을 수 있어, "소스가
 *   없으면 매번 다시 심는다"는 그 의도를 매번 무시하게 된다.
 * - 실패해도 예외를 던지지 않는다(호출부가 앱 기동 경로에 그대로 물려도 안전).
 */
import fs from 'node:fs'
import path from 'node:path'
import type {
  GearLeverAppConfig,
  GearLeverCommandResult
} from '../engine/capabilities/appimage/providerTypes'
import type { UpdateManagerModel } from '../engine/capabilities/appimage/types'
import {
  SELF_UPDATE_REPO_FILENAME_GLOB,
  SELF_UPDATE_SOURCE_OWNER,
  SELF_UPDATE_SOURCE_REPO
} from '../engine/doctor/selfUpdateCheck'

const SELF_UPDATE_STATE_FILENAME = 'self-update-state.json'

export interface SelfUpdateState {
  readonly attempted: true
  readonly attemptedAt: string
  readonly result: 'ok' | 'failed'
  readonly detail: string
}

export function selfUpdateStatePath(stateDir: string): string {
  return path.join(stateDir, SELF_UPDATE_STATE_FILENAME)
}

/** 상태 파일이 없거나 깨져 있으면 "아직 시도 안 함"으로 취급(null) -- 안전한 기본값. */
export function readSelfUpdateState(stateDir: string): SelfUpdateState | null {
  const file = selfUpdateStatePath(stateDir)
  if (!fs.existsSync(file)) return null
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { attempted?: unknown }).attempted === true
    ) {
      return parsed as SelfUpdateState
    }
    return null
  } catch {
    return null
  }
}

export function writeSelfUpdateState(stateDir: string, state: SelfUpdateState): void {
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(selfUpdateStatePath(stateDir), JSON.stringify(state, null, 2))
}

export type SelfRegistrationDecision =
  | 'not-appimage'
  | 'already-attempted'
  | 'gearlever-unavailable'
  | 'source-already-set'
  | 'attempt'
  | 'error'

/**
 * 순수 판단 함수 -- 실제 I/O 결과(이미 계산된 값)를 받아 "지금 등록을
 * 시도해야 하는가"만 answer한다. electron·fs·CLI 호출을 전혀 하지 않아
 * fixture 값만으로 모든 분기를 유닛 테스트할 수 있다.
 */
export function decideSelfRegistration(input: {
  readonly appImagePath: string | null
  readonly alreadyAttempted: boolean
  readonly gearLeverAvailable: boolean
  readonly existingRepo: string | null | undefined
}): SelfRegistrationDecision {
  if (!input.appImagePath) return 'not-appimage'
  if (input.alreadyAttempted) return 'already-attempted'
  if (!input.gearLeverAvailable) return 'gearlever-unavailable'
  if (input.existingRepo) return 'source-already-set'
  return 'attempt'
}

export interface SelfRegistrationDeps {
  /** `process.env.APPIMAGE` -- 호출부가 읽어서 넘긴다(이 파일은 process.env를 직접 읽지 않는다). */
  readonly appImagePath: string | null
  readonly isGearLeverAvailable: () => boolean
  readonly readAppConfig: (appImagePath: string) => GearLeverAppConfig | null
  readonly setUpdateSource: (
    appImagePath: string,
    manager: UpdateManagerModel,
    params: Readonly<Record<string, string>>
  ) => GearLeverCommandResult
  readonly readState: () => SelfUpdateState | null
  readonly writeState: (state: SelfUpdateState) => void
  readonly now?: () => Date
  readonly log?: (message: string) => void
}

/**
 * 실제 조립 -- 판단은 `decideSelfRegistration`에 위임하고, 'attempt'일 때만
 * `setUpdateSource`를 부른 뒤 성공/실패 무관하게 상태를 기록한다. 예외는
 * 여기서 전부 삼킨다(기동을 막지 않는다는 명세).
 */
export function attemptSelfUpdateRegistration(
  deps: SelfRegistrationDeps
): SelfRegistrationDecision {
  const log = deps.log ?? ((message: string): void => console.log(message))
  try {
    const state = deps.readState()
    const alreadyAttempted = state?.attempted === true
    const gearLeverAvailable = deps.appImagePath ? deps.isGearLeverAvailable() : false
    const existingConfig =
      deps.appImagePath && gearLeverAvailable ? deps.readAppConfig(deps.appImagePath) : null

    const decision = decideSelfRegistration({
      appImagePath: deps.appImagePath,
      alreadyAttempted,
      gearLeverAvailable,
      existingRepo: existingConfig?.updateManager?.repo
    })

    if (decision !== 'attempt') {
      if (decision !== 'not-appimage') {
        log(`[self-update] skip registration (${decision})`)
      }
      return decision
    }

    // deps.appImagePath는 decideSelfRegistration이 'attempt'를 반환했다는
    // 것만으로 non-null임이 보장된다(첫 분기가 null을 걸러낸다) -- TS 좁히기용.
    const appImagePath = deps.appImagePath as string
    const result = deps.setUpdateSource(appImagePath, 'GithubUpdater', {
      repo: `${SELF_UPDATE_SOURCE_OWNER}/${SELF_UPDATE_SOURCE_REPO}`,
      repo_filename: SELF_UPDATE_REPO_FILENAME_GLOB,
      allow_prereleases: 'false'
    })
    const now = deps.now ?? ((): Date => new Date())
    deps.writeState({
      attempted: true,
      attemptedAt: now().toISOString(),
      result: result.ok ? 'ok' : 'failed',
      detail: result.output
    })
    log(`[self-update] registration attempted -- ${result.ok ? 'ok' : 'failed'}: ${result.output}`)
    return decision
  } catch (err) {
    log(`[self-update] registration threw -- ${err instanceof Error ? err.message : String(err)}`)
    return 'error'
  }
}
