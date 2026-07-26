/**
 * fonts plan — 좌표 해석 → 다운로드 → (zip이면 추출) →
 * `~/.local/share/fonts/<name>/`에 배치 → `fc-cache -f`. 전부 unprivileged
 * (홈 디렉터리 쓰기 + 사용자 fontconfig 캐시라 sudo 불필요 — appimage plan과
 * 동일한 원칙).
 *
 * 멱등성: destDir에 이미 파일이 있으면 덮어쓰기 전 백업(불변식 ②, doBackup),
 * diff.toInstall에 없는(=이미 올바르게 설치된) 엔트리는 애초에 액션이 생기지
 * 않는다(diff 단계에서 걸러짐).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import type { PlanAction } from '../../plan'
import { doBackup } from '../../safety/backup'
import { FONTS_KEY_FIELDS, FONTS_LAYER } from './constants'
import type {
  FontAssetResolver,
  FontDownloader,
  FontsSystemProvider,
  ZipExtractor
} from './providerTypes'
import { fontInstallDir } from './scan'
import type { FontEntry, FontsDiffReport } from './types'

function entriesByName(ctx: RigsyncContext): Map<string, FontEntry> {
  const manifest =
    (effectiveLayer(ctx, FONTS_LAYER, FONTS_KEY_FIELDS).font as FontEntry[] | undefined) ?? []
  return new Map(manifest.map((e) => [e.name, e]))
}

function urlFilename(url: string): string {
  try {
    return decodeURIComponent(path.basename(new URL(url).pathname))
  } catch {
    return path.basename(url)
  }
}

const FONT_ENTRY_PATTERN = /\.(ttf|otf|ttc)$/i

function makeInstallAction(
  ctx: RigsyncContext,
  entry: FontEntry,
  resolver: FontAssetResolver,
  downloader: FontDownloader,
  zipExtractor: ZipExtractor,
  systemProvider: FontsSystemProvider,
  runTs: string
): PlanAction {
  const destDir = fontInstallDir(ctx, entry.name)
  const commands =
    entry.source.kind === 'static'
      ? [
          `# ${entry.name} — 직접 URL ${entry.source.urls.length}개 다운로드 후 ${destDir}/에 배치`,
          'fc-cache -f'
        ]
      : [
          `# ${entry.source.coordinate}에서 "${entry.source.assetPattern}" 패턴에 맞는 릴리스 asset 해석`,
          `# 다운로드한 zip에서 폰트 파일만 추출해 ${destDir}/에 배치`,
          'fc-cache -f'
        ]

  return {
    capability: 'fonts',
    summary:
      entry.source.kind === 'static'
        ? `install ${entry.name}`
        : `install ${entry.name} (${entry.source.coordinate})`,
    commands,
    privileged: false,
    run: async () => {
      if (fs.existsSync(destDir)) {
        doBackup(ctx, destDir, runTs)
      }
      fs.mkdirSync(destDir, { recursive: true })

      if (entry.source.kind === 'static') {
        for (const url of entry.source.urls) {
          const destPath = path.join(destDir, urlFilename(url))
          const result = await downloader.download(url, destPath)
          if (!result.ok) return { ok: false, detail: result.detail }
        }
      } else {
        const asset = await resolver.resolveAsset(
          entry.source.coordinate,
          entry.source.assetPattern,
          entry.pin ?? null
        )
        if (!asset) {
          return {
            ok: false,
            detail: `"${entry.source.assetPattern}" 패턴에 맞는 릴리스 asset을 찾지 못함`
          }
        }
        const tmpZip = path.join(os.tmpdir(), `rigsync-font-${Date.now()}-${asset.name}`)
        const downloadResult = await downloader.download(asset.downloadUrl, tmpZip)
        if (!downloadResult.ok) return { ok: false, detail: downloadResult.detail }

        const extracted = zipExtractor.extract(tmpZip, destDir, (name) =>
          FONT_ENTRY_PATTERN.test(name)
        )
        if (!extracted.ok || extracted.extractedPaths.length === 0) {
          return {
            ok: false,
            detail: extracted.detail ?? 'zip 안에서 폰트 파일(.ttf/.otf/.ttc)을 찾지 못함'
          }
        }
      }

      const fcCacheResult = systemProvider.runFcCache()
      return {
        ok: fcCacheResult.ok,
        detail: fcCacheResult.ok
          ? `설치 완료: ${entry.name} -> ${destDir}`
          : `설치는 됐지만 fc-cache 실패: ${fcCacheResult.output}`
      }
    }
  }
}

export function planFonts(
  ctx: RigsyncContext,
  diff: FontsDiffReport,
  resolver: FontAssetResolver,
  downloader: FontDownloader,
  zipExtractor: ZipExtractor,
  systemProvider: FontsSystemProvider,
  runTs: string
): PlanAction[] {
  const byName = entriesByName(ctx)
  const actions: PlanAction[] = []
  for (const name of diff.toInstall) {
    const entry = byName.get(name)
    if (!entry) continue
    actions.push(
      makeInstallAction(ctx, entry, resolver, downloader, zipExtractor, systemProvider, runTs)
    )
  }
  return actions
}
