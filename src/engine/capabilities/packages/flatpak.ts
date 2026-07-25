/**
 * flatpak 레이어 — 구 repo `capture_flatpak`/`diff_flatpak`/`plan_flatpak`
 * 행동을 옮긴 것(코드 복사 아님). 구 repo의 명령은 시스템 전역 설치
 * (`flatpak install -y ...`, sudo/polkit 필요)였지만, 이 repo는 `--user`를
 * 붙여 사용자 설치로 바꿨다(P2a 결정 ② — "flatpak은 --user 설치라 unprivileged
 * 로 실행 가능") — 그래서 apt/snap과 달리 `privileged: false`이고 실제로
 * run()이 실행된다.
 */
import { readIgnoreSet } from '../../ignore'
import type { RigsyncContext } from '../../context'
import type { PlanAction } from '../../plan'
import { readCommonPackages, readEffectivePackages, writeCommonFlatpakSection } from './io'
import type { FlatpakProvider } from './providerTypes'
import type {
  FlatpakAppEntry,
  FlatpakCaptureReport,
  FlatpakDiffReport,
  FlatpakRemoteEntry
} from './types'

export interface CaptureFlatpakOptions {
  readonly dryRun: boolean
}

export async function captureFlatpak(
  ctx: RigsyncContext,
  provider: FlatpakProvider,
  options: CaptureFlatpakOptions
): Promise<FlatpakCaptureReport> {
  if (!provider.isAvailable()) {
    return { skipped: true, remotes: 0, apps: 0, addedRemotes: 0, addedApps: 0 }
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

  let addedRemotes = 0
  let addedApps = 0
  for (const r of provider.remotes()) {
    if (!remotes.has(r.name)) addedRemotes += 1
    remotes.set(r.name, r)
  }
  for (const a of provider.apps()) {
    if (ignoreApps.has(a.application)) continue
    if (!apps.has(a.application)) addedApps += 1
    apps.set(a.application, a)
  }

  const section = {
    ...(remotes.size > 0 ? { remote: [...remotes.values()] } : {}),
    ...(apps.size > 0 ? { app: [...apps.values()] } : {})
  }
  if (!options.dryRun) {
    writeCommonFlatpakSection(ctx, section)
  }

  return { skipped: false, remotes: remotes.size, apps: apps.size, addedRemotes, addedApps }
}

export async function diffFlatpak(
  ctx: RigsyncContext,
  provider: FlatpakProvider
): Promise<FlatpakDiffReport> {
  if (!provider.isAvailable()) {
    return { skipped: true, toAddRemotes: [], toInstall: [], uncaptured: [] }
  }

  const ignoreApps = readIgnoreSet(ctx, 'flatpak', 'apps')
  const manifest = readEffectivePackages(ctx).flatpak ?? {}
  const liveRemotes = new Set(provider.remotes().map((r) => r.name))
  const liveApps = provider.apps()
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

  return { skipped: false, toAddRemotes, toInstall, uncaptured }
}

export function planFlatpak(provider: FlatpakProvider, diff: FlatpakDiffReport): PlanAction[] {
  if (diff.skipped) return []
  const actions: PlanAction[] = []

  for (const r of diff.toAddRemotes) {
    actions.push({
      capability: 'packages',
      summary: `add flatpak remote ${r.name}`,
      commands: [`flatpak remote-add --user --if-not-exists ${r.name} ${r.url}`],
      privileged: false,
      run: async () => {
        const result = provider.addRemoteUser(r.name, r.url)
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
        const result = provider.installAppUser(a.origin, a.application)
        return { ok: result.ok, detail: result.output }
      }
    })
  }

  return actions
}
