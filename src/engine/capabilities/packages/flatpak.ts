/**
 * flatpak 레이어 — 구 repo `capture_flatpak`/`diff_flatpak`/`plan_flatpak`
 * 행동을 옮긴 것(코드 복사 아님). 구 repo의 명령은 시스템 전역 설치
 * (`flatpak install -y ...`, sudo/polkit 필요)였지만, 이 repo는 `--user`를
 * 붙여 사용자 설치로 바꿨다(P2a 결정 ② — "flatpak은 --user 설치라 unprivileged
 * 로 실행 가능") — 그래서 apt/snap과 달리 `privileged: false`이고 실제로
 * run()이 실행된다.
 *
 * P2c 결정 ④: 권한 오버라이드 파일(`~/.local/share/flatpak/overrides/`) 동기화
 * 추가 — 파일 단위, "덮어쓰기 전 백업" 안전선(불변식 ②)을 dotfiles와 동일한
 * 정신으로 지킨다(라이브 경로가 homeDir 밖이라 `doBackup` 자체는 그대로 못
 * 쓰지만, 백업 후 교체하는 흐름은 같다).
 */
import fs from 'node:fs'
import path from 'node:path'
import { readIgnoreSet } from '../../ignore'
import type { RigsyncContext } from '../../context'
import type { PlanAction } from '../../plan'
import type { CapabilityUninstallResult, UninstallExclusion } from '../../uninstall/types'
import { readCommonPackages, readEffectivePackages, writeCommonFlatpakSection } from './io'
import type { FlatpakProvider } from './providerTypes'
import type {
  FlatpakAppEntry,
  FlatpakCaptureReport,
  FlatpakDiffReport,
  FlatpakOverrideEntry,
  FlatpakRemoteEntry
} from './types'

export interface CaptureFlatpakOptions {
  readonly dryRun: boolean
}

function overrideStoreFile(appId: string): string {
  return `packages/flatpak/overrides/${appId}`
}

export async function captureFlatpak(
  ctx: RigsyncContext,
  provider: FlatpakProvider,
  options: CaptureFlatpakOptions
): Promise<FlatpakCaptureReport> {
  if (!provider.isAvailable()) {
    return {
      skipped: true,
      remotes: 0,
      apps: 0,
      addedRemotes: 0,
      addedApps: 0,
      overridesCaptured: 0,
      overridesAdded: 0
    }
  }

  const ignoreApps = readIgnoreSet(ctx, 'flatpak', 'apps')
  const existing = readCommonPackages(ctx).flatpak ?? {}
  const remotes = new Map<string, FlatpakRemoteEntry>(
    (existing.remote ?? []).map((r) => [r.name, r])
  )
  const apps = new Map<string, FlatpakAppEntry>(
    (existing.app ?? [])
      .filter((a) => !ignoreApps.has(a.application))
      .map((a) => [a.application, a])
  )
  const overrides = new Map<string, FlatpakOverrideEntry>(
    (existing.overrides ?? []).map((o) => [o.appId, o])
  )

  let addedRemotes = 0
  let addedApps = 0
  let addedOverrides = 0
  for (const r of await provider.remotes()) {
    if (!remotes.has(r.name)) addedRemotes += 1
    remotes.set(r.name, r)
  }
  for (const a of await provider.apps()) {
    if (ignoreApps.has(a.application)) continue
    if (!apps.has(a.application)) addedApps += 1
    apps.set(a.application, a)
  }
  for (const file of provider.listOverrideFiles()) {
    if (!options.dryRun) {
      const storeAbs = path.join(ctx.manifestDir, overrideStoreFile(file.appId))
      fs.mkdirSync(path.dirname(storeAbs), { recursive: true })
      fs.writeFileSync(storeAbs, file.content)
    }
    if (!overrides.has(file.appId)) addedOverrides += 1
    overrides.set(file.appId, { appId: file.appId, storeFile: overrideStoreFile(file.appId) })
  }

  const section = {
    ...(remotes.size > 0 ? { remote: [...remotes.values()] } : {}),
    ...(apps.size > 0 ? { app: [...apps.values()] } : {}),
    ...(overrides.size > 0 ? { overrides: [...overrides.values()] } : {})
  }
  if (!options.dryRun) {
    writeCommonFlatpakSection(ctx, section)
  }

  return {
    skipped: false,
    remotes: remotes.size,
    apps: apps.size,
    addedRemotes,
    addedApps,
    overridesCaptured: overrides.size,
    overridesAdded: addedOverrides
  }
}

export async function diffFlatpak(
  ctx: RigsyncContext,
  provider: FlatpakProvider
): Promise<FlatpakDiffReport> {
  if (!provider.isAvailable()) {
    return {
      skipped: true,
      toAddRemotes: [],
      toInstall: [],
      uncaptured: [],
      overridesMissing: [],
      overridesChanged: []
    }
  }

  const ignoreApps = readIgnoreSet(ctx, 'flatpak', 'apps')
  const manifest = readEffectivePackages(ctx).flatpak ?? {}
  const liveRemotes = new Set((await provider.remotes()).map((r) => r.name))
  const liveApps = await provider.apps()
  const liveAppNames = new Set(liveApps.map((a) => a.application))
  const manifestAppNames = new Set((manifest.app ?? []).map((a) => a.application))

  const toAddRemotes = (manifest.remote ?? []).filter((r) => !liveRemotes.has(r.name))
  const toInstall = (manifest.app ?? []).filter(
    (a) => !liveAppNames.has(a.application) && !ignoreApps.has(a.application)
  )
  const uncaptured = liveApps
    .map((a) => a.application)
    .filter((name) => !manifestAppNames.has(name) && !ignoreApps.has(name))
    .sort()

  const overridesMissing: string[] = []
  const overridesChanged: string[] = []
  for (const o of manifest.overrides ?? []) {
    if (!provider.overrideFileExists(o.appId)) {
      overridesMissing.push(o.appId)
      continue
    }
    const storeAbs = path.join(ctx.manifestDir, o.storeFile)
    if (fs.existsSync(storeAbs)) {
      const liveBytes = provider.readOverrideFileBytes(o.appId)
      const storedBytes = fs.readFileSync(storeAbs)
      if (liveBytes && !liveBytes.equals(storedBytes)) {
        overridesChanged.push(o.appId)
      }
    }
  }

  return { skipped: false, toAddRemotes, toInstall, uncaptured, overridesMissing, overridesChanged }
}

/**
 * override 복원 액션 — apt/keyring 복원과 달리 unprivileged라 `run()`이
 * 테스트에서도 실제로 호출된다. 그래서 라이브 파일 읽기/쓰기를 전부
 * `FlatpakProvider`(fake 주입 가능)로 격리하고, 백업만 우리 `ctx.backupRoot`
 * 안에 직접 쓴다(homeDir 바깥 경로라 dotfiles의 `doBackup`을 그대로 못 쓰지만,
 * "덮어쓰기 전 백업" 안전선 자체는 동일하게 지킨다).
 */
function makeOverrideRestoreAction(
  ctx: RigsyncContext,
  provider: FlatpakProvider,
  override: FlatpakOverrideEntry,
  runTs: string
): PlanAction {
  const storeAbs = path.join(ctx.manifestDir, override.storeFile)
  return {
    capability: 'packages',
    summary: `restore flatpak override ${override.appId}`,
    commands: [
      `# 백업 후 ~/.local/share/flatpak/overrides/${override.appId} 갱신`,
      `cp ${storeAbs} ~/.local/share/flatpak/overrides/${override.appId}`
    ],
    privileged: false,
    run: async () => {
      if (!fs.existsSync(storeAbs)) {
        return {
          ok: false,
          detail: `스토어에 override 파일이 없음 (${override.storeFile}) -- capture를 먼저 실행하세요`
        }
      }
      if (provider.overrideFileExists(override.appId)) {
        const liveBytes = provider.readOverrideFileBytes(override.appId)
        if (liveBytes) {
          const backupPath = path.join(ctx.backupRoot, runTs, 'flatpak-overrides', override.appId)
          fs.mkdirSync(path.dirname(backupPath), { recursive: true })
          fs.writeFileSync(backupPath, liveBytes)
        }
      }
      const storedBytes = fs.readFileSync(storeAbs)
      const result = provider.writeOverrideFile(override.appId, storedBytes)
      return {
        ok: result.ok,
        detail: result.output || (result.ok ? `restored ${override.appId}` : '복원 실패')
      }
    }
  }
}

/**
 * v0.1.7 수정(신선한 머신 첫 apply 실사고): capture는 `flatpak remotes`에서
 * remote의 **repo URL만** 얻는데, 그 평문 URL로 `remote-add`하면 GPG 키 없는
 * remote가 만들어져 이후 모든 설치가 "No remote refs found"로 죽는다
 * (lab-main에서 실제 발생). 알려진 remote는 GPG 키가 포함된 `.flatpakrepo`
 * 참조로 바꿔 추가한다 — 모르는 remote는 기존 동작(URL 그대로) 유지.
 */
export function flatpakrepoRefFor(url: string): string {
  const normalized = url.replace(/\/+$/, '')
  if (normalized === 'https://dl.flathub.org/repo')
    return 'https://dl.flathub.org/repo/flathub.flatpakrepo'
  if (normalized === 'https://dl.flathub.org/beta-repo')
    return 'https://dl.flathub.org/beta-repo/flathub-beta.flatpakrepo'
  return url
}

export function planFlatpak(
  ctx: RigsyncContext,
  provider: FlatpakProvider,
  diff: FlatpakDiffReport,
  runTs: string
): PlanAction[] {
  if (diff.skipped) return []
  const actions: PlanAction[] = []

  for (const r of diff.toAddRemotes) {
    const addRef = flatpakrepoRefFor(r.url)
    actions.push({
      capability: 'packages',
      summary: `add flatpak remote ${r.name}`,
      commands: [`flatpak remote-add --user --if-not-exists ${r.name} ${addRef}`],
      privileged: false,
      run: async () => {
        const result = await provider.addRemoteUser(r.name, addRef)
        return { ok: result.ok, detail: result.output }
      }
    })
  }

  for (const a of diff.toInstall) {
    actions.push({
      capability: 'packages',
      summary: `install ${a.application}`,
      commands: [`flatpak install --user -y ${a.origin} ${a.application}`],
      privileged: false,
      run: async () => {
        const result = await provider.installAppUser(a.origin, a.application)
        return { ok: result.ok, detail: result.output }
      }
    })
  }

  const manifest = readEffectivePackages(ctx).flatpak ?? {}
  const overridesByAppId = new Map((manifest.overrides ?? []).map((o) => [o.appId, o]))
  for (const appId of new Set([...diff.overridesMissing, ...diff.overridesChanged])) {
    const override = overridesByAppId.get(appId)
    if (!override) continue
    actions.push(makeOverrideRestoreAction(ctx, provider, override, runTs))
  }

  return actions
}

/**
 * flatpak uninstall 계획 — 안전 불변식 5: manifest에 선언된(managed) app은
 * 거부하고, ignore(일시중지)되지 않은 app도 거부한다. `--user` 설치라
 * unprivileged로 실제 실행되며(install과 대칭), apt와 달리 개별 app마다
 * 별도 액션이다(코디네이터 지시 — apt만 한 명령으로 묶는다).
 */
export async function planFlatpakUninstall(
  ctx: RigsyncContext,
  provider: FlatpakProvider,
  requestedAppIds: readonly string[]
): Promise<CapabilityUninstallResult> {
  if (!provider.isAvailable()) {
    return {
      actions: [],
      excluded: requestedAppIds.map((key) => ({
        capability: 'flatpak',
        key,
        reason: 'flatpak을 찾을 수 없음(flatpak 미사용 환경)'
      }))
    }
  }

  const manifest = readEffectivePackages(ctx).flatpak ?? {}
  const managedSet = new Set((manifest.app ?? []).map((a) => a.application))
  const ignore = readIgnoreSet(ctx, 'flatpak', 'apps')
  const installedSet = new Set((await provider.apps()).map((a) => a.application))

  const actions: PlanAction[] = []
  const excluded: UninstallExclusion[] = []

  for (const appId of requestedAppIds) {
    if (managedSet.has(appId)) {
      excluded.push({
        capability: 'flatpak',
        key: appId,
        reason: 'manifest에 선언된(managed) 항목은 삭제 대상이 아님 — 먼저 일시중지(ignore)하세요'
      })
      continue
    }
    if (!ignore.has(appId)) {
      excluded.push({
        capability: 'flatpak',
        key: appId,
        reason: '일시중지(ignore)되지 않은 항목은 삭제 대상이 아님'
      })
      continue
    }
    if (!installedSet.has(appId)) {
      excluded.push({ capability: 'flatpak', key: appId, reason: '이 머신에 설치돼 있지 않음' })
      continue
    }
    actions.push({
      capability: 'packages',
      summary: `uninstall flatpak ${appId}`,
      commands: [`flatpak uninstall --user -y ${appId}`],
      privileged: false,
      run: async () => {
        const result = await provider.uninstallAppUser(appId)
        return { ok: result.ok, detail: result.output }
      }
    })
  }

  return { actions, excluded }
}
