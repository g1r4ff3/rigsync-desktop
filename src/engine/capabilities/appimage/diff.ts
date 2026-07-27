/**
 * appimage diff — manifest(effective) vs Gear Lever의 실제 설치 상태.
 * pin이 지정된 엔트리는 버전 불일치도 drift로 잡는다(정책 §7). GithubUpdater가
 * 아닌 source는 drift 표시는 하되(정직하게) apply가 자동 설치를 지원하지
 * 않는다는 걸 `unsupportedSource`로 분리해 둔다 — plan 단계가 이걸 보고
 * skipped 처리한다.
 */
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import { APPIMAGE_KEY_FIELDS, APPIMAGE_LAYER } from './constants'
import type { GearLeverProvider } from './providerTypes'
import type { AppimageDiffReport, AppimageEntry } from './types'

export async function diffAppimage(
  ctx: RigsyncContext,
  provider: GearLeverProvider
): Promise<AppimageDiffReport> {
  if (!(await provider.isAvailable())) {
    return { skipped: true, toInstall: [], pinMismatch: [], unsupportedSource: [], uncaptured: [] }
  }

  const manifest =
    (effectiveLayer(ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS).app as AppimageEntry[] | undefined) ??
    []
  const installedRows = await provider.listInstalled()
  const installedByDesktopId = new Map(installedRows.map((r) => [r.desktopId, r]))
  const manifestNames = new Set(manifest.map((e) => e.name))

  const toInstall: string[] = []
  const pinMismatch: { name: string; pinned: string; installed: string }[] = []
  const unsupportedSource: string[] = []

  for (const entry of manifest) {
    const installed = installedByDesktopId.get(entry.name)
    if (!installed) {
      toInstall.push(entry.name)
      continue
    }
    if (entry.source !== 'GithubUpdater') {
      unsupportedSource.push(entry.name)
    }
    if (entry.pin && installed.currentVersion && entry.pin !== installed.currentVersion) {
      pinMismatch.push({ name: entry.name, pinned: entry.pin, installed: installed.currentVersion })
    }
  }

  const uncaptured = installedRows
    .map((r) => r.desktopId)
    .filter((id) => !manifestNames.has(id))
    .sort()

  return { skipped: false, toInstall, pinMismatch, unsupportedSource, uncaptured }
}
