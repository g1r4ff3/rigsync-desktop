/**
 * snap 레이어 — 구 repo `capture_snap`/`diff_snap`/`plan_snap` 행동을 옮긴 것
 * (코드 복사 아님). `snap install`은 시스템 전역 설치라 sudo가 필요 —
 * `privileged: true` (P2b 전까지 실행 보류).
 */
import { readIgnoreSet } from '../../ignore'
import type { RigsyncContext } from '../../context'
import type { PlanAction } from '../../plan'
import { readCommonPackages, writeCommonSnapSection, readEffectivePackages } from './io'
import type { SnapProvider } from './providerTypes'
import type { SnapCaptureReport, SnapDiffReport, SnapEntry } from './types'

export interface CaptureSnapOptions {
  readonly dryRun: boolean
}

export async function captureSnap(
  ctx: RigsyncContext,
  provider: SnapProvider,
  options: CaptureSnapOptions
): Promise<SnapCaptureReport> {
  if (!provider.isAvailable()) {
    return { skipped: true, captured: 0, added: 0 }
  }

  const ignore = readIgnoreSet(ctx, 'snap', 'packages')
  const existing = readCommonPackages(ctx).snap ?? {}
  const existingMap = new Map<string, SnapEntry>(
    (existing.snap ?? []).filter((s) => !ignore.has(s.name)).map((s) => [s.name, s])
  )

  let added = 0
  for (const row of await provider.list()) {
    if (ignore.has(row.name) || row.notes.includes('base')) continue
    const entry: SnapEntry = { name: row.name, classic: row.notes.includes('classic') }
    if (!existingMap.has(row.name)) added += 1
    existingMap.set(row.name, entry)
  }

  if (!options.dryRun) {
    writeCommonSnapSection(ctx, existingMap.size > 0 ? { snap: [...existingMap.values()] } : {})
  }
  return { skipped: false, captured: existingMap.size, added }
}

export async function diffSnap(
  ctx: RigsyncContext,
  provider: SnapProvider
): Promise<SnapDiffReport> {
  if (!provider.isAvailable()) {
    return { skipped: true, toInstall: [], uncaptured: [] }
  }

  const ignore = readIgnoreSet(ctx, 'snap', 'packages')
  const manifest = readEffectivePackages(ctx).snap ?? {}
  const manifestEntries = (manifest.snap ?? []).filter((s) => !ignore.has(s.name))
  const manifestNames = new Set(manifestEntries.map((s) => s.name))
  const installed = new Set((await provider.list()).map((r) => r.name))

  const toInstall = manifestEntries.filter((s) => !installed.has(s.name))
  const uncaptured = [...installed]
    .filter((name) => !manifestNames.has(name) && !ignore.has(name))
    .sort()

  return { skipped: false, toInstall, uncaptured }
}

export function planSnap(diff: SnapDiffReport): PlanAction[] {
  if (diff.skipped) return []
  return diff.toInstall.map((s) => {
    const cmd = ['sudo', 'snap', 'install', s.name, ...(s.classic ? ['--classic'] : [])]
    return {
      capability: 'packages',
      summary: `snap install ${s.name}`,
      commands: [cmd.join(' ')],
      privileged: true,
      run: async (): Promise<{ ok: boolean; detail: string }> => {
        throw new Error(
          'privileged snap actions are not executed until P2b (privilege elevation integration)'
        )
      }
    }
  })
}
