/**
 * appimage plan — 좌표(coordinate)에서 최신(또는 pin된) asset을 해석하고
 * 다운로드한 뒤 `--integrate --yes` → `--set-update-source`로 통합한다. 전부
 * unprivileged(홈 디렉터리 다운로드 + flatpak CLI라 sudo 불필요 — 구 repo
 * `test_download_action_planned_not_sudo`의 "홈 디렉터리 다운로드만, sudo
 * 없음" 행동을 이 모델에서도 그대로 유지).
 *
 * GithubUpdater가 아닌 source는 액션 자체를 만들지만 `skipReason`을 달아
 * `run()`이 절대 호출되지 않게 한다 — "diff에 표시하되 apply는 미지원 소스
 * skipped 처리(정직하게)"(정책 §7).
 */
import os from 'node:os'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import type { PlanAction } from '../../plan'
import { APPIMAGE_KEY_FIELDS, APPIMAGE_LAYER } from './constants'
import type { AssetResolver, Downloader, GearLeverProvider } from './providerTypes'
import type { AppimageDiffReport, AppimageEntry } from './types'

function entriesByName(ctx: RigsyncContext): Map<string, AppimageEntry> {
  const manifest =
    (effectiveLayer(ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS).app as AppimageEntry[] | undefined) ??
    []
  return new Map(manifest.map((e) => [e.name, e]))
}

function makeUnsupportedAction(entry: AppimageEntry): PlanAction {
  return {
    capability: 'appimage',
    summary: `${entry.name} (${entry.source} — 미지원 소스)`,
    commands: [
      `# ${entry.source}는 자동 설치를 지원하지 않습니다 -- Gear Lever GUI에서 직접 처리하세요`
    ],
    skipReason: `미지원 소스: ${entry.source} (자동 설치는 GithubUpdater만 지원)`,
    run: async () => {
      throw new Error('skipReason이 설정된 액션은 실행되지 않아야 한다 (PlanExecutor 버그)')
    }
  }
}

function makeInstallAction(
  entry: AppimageEntry,
  provider: GearLeverProvider,
  resolver: AssetResolver,
  downloader: Downloader
): PlanAction {
  return {
    capability: 'appimage',
    summary: `integrate ${entry.name} (${entry.coordinate})`,
    commands: [
      `# ${entry.coordinate}에서 ${entry.repoFilename} 최신 릴리스 asset 해석 후 다운로드`,
      'gearlever --integrate <다운로드한 AppImage> --yes',
      `gearlever --set-update-source <다운로드한 AppImage> --manager GithubUpdater repo=${entry.coordinate} repo_filename=${entry.repoFilename} allow_prereleases=false`
    ],
    privileged: false,
    run: async () => {
      const asset = await resolver.resolveAsset(
        entry.coordinate,
        entry.repoFilename,
        entry.pin ?? null
      )
      if (!asset) {
        return {
          ok: false,
          detail: `${entry.coordinate}에서 "${entry.repoFilename}"에 맞는 릴리스 asset을 찾지 못함`
        }
      }

      const destPath = path.join(
        os.tmpdir(),
        `rigsync-appimage-${Date.now()}-${entry.repoFilename}`
      )
      const downloadResult = await downloader.download(asset.downloadUrl, destPath)
      if (!downloadResult.ok) {
        return { ok: false, detail: downloadResult.detail }
      }

      const integrateResult = provider.integrate(destPath)
      if (!integrateResult.ok) {
        return { ok: false, detail: integrateResult.output || '통합(integrate) 실패' }
      }

      const setSourceResult = provider.setUpdateSource(destPath, 'GithubUpdater', {
        repo: entry.coordinate,
        repo_filename: entry.repoFilename,
        allow_prereleases: 'false'
      })
      return {
        ok: setSourceResult.ok,
        detail: setSourceResult.output || (setSourceResult.ok ? '완료' : '업데이트 소스 설정 실패')
      }
    }
  }
}

export function planAppimage(
  ctx: RigsyncContext,
  provider: GearLeverProvider,
  resolver: AssetResolver,
  downloader: Downloader,
  diff: AppimageDiffReport
): PlanAction[] {
  if (diff.skipped) return []
  const byName = entriesByName(ctx)
  const targets = new Set<string>([...diff.toInstall, ...diff.pinMismatch.map((m) => m.name)])

  const actions: PlanAction[] = []
  for (const name of targets) {
    const entry = byName.get(name)
    if (!entry) continue
    actions.push(
      entry.source !== 'GithubUpdater'
        ? makeUnsupportedAction(entry)
        : makeInstallAction(entry, provider, resolver, downloader)
    )
  }
  return actions
}
