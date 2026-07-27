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
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import type { PlanAction } from '../../plan'
import { doBackup } from '../../safety/backup'
import type { CapabilityUninstallResult, UninstallExclusion } from '../../uninstall/types'
import { FONTS_KEY_FIELDS, FONTS_LAYER } from './constants'
import type {
  FontAssetResolver,
  FontDownloader,
  FontsSystemProvider,
  ZipExtractor
} from './providerTypes'
import { fontInstallDir, groupInstalledFontFiles, locateFontFiles } from './scan'
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

      const fcCacheResult = await systemProvider.runFcCache()
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

/**
 * name 하나에 속한 폰트 파일들(fullPaths, fontDirs() 하위 실제 경로)을 지우는
 * 액션 — 불변식 ②에 따라 파일마다 백업 후 삭제하고, 마지막에 `fc-cache -f`로
 * 캐시를 갱신한다(install 경로와 대칭).
 */
function makeFontUninstallAction(
  ctx: RigsyncContext,
  name: string,
  fullPaths: readonly string[],
  systemProvider: FontsSystemProvider,
  runTs: string
): PlanAction {
  const commands = [...fullPaths.flatMap((p) => [`backup ${p}`, `rm ${p}`]), 'fc-cache -f']
  return {
    capability: 'fonts',
    summary: `uninstall ${name}`,
    commands,
    privileged: false,
    run: async () => {
      for (const p of fullPaths) {
        if (fs.existsSync(p)) {
          doBackup(ctx, p, runTs)
          fs.unlinkSync(p)
        }
      }
      const fcCacheResult = await systemProvider.runFcCache()
      return {
        ok: fcCacheResult.ok,
        detail: fcCacheResult.ok
          ? `삭제 완료: ${name}`
          : `삭제는 됐지만 fc-cache 실패: ${fcCacheResult.output}`
      }
    }
  }
}

/**
 * fonts uninstall 계획 — 안전 불변식 5: manifest에 선언된(managed) 항목은
 * 거부하고, ignore(일시중지)되지 않은 항목도 거부한다. 대상 파일 경로는
 * `groupInstalledFontFiles`(레지스트리 매칭)로 얻은 파일명을
 * `locateFontFiles`로 fontDirs() 하위에서 실제 경로로 되찾는다.
 */
export function planFontsUninstall(
  ctx: RigsyncContext,
  requestedNames: readonly string[],
  systemProvider: FontsSystemProvider,
  runTs: string
): CapabilityUninstallResult {
  const manifest =
    (effectiveLayer(ctx, FONTS_LAYER, FONTS_KEY_FIELDS).font as FontEntry[] | undefined) ?? []
  const managedSet = new Set(manifest.map((e) => e.name))
  const ignore = readIgnoreSet(ctx, 'fonts', 'names')
  const { resolvedByName } = groupInstalledFontFiles(ctx, manifest)

  const actions: PlanAction[] = []
  const excluded: UninstallExclusion[] = []

  for (const name of requestedNames) {
    if (managedSet.has(name)) {
      excluded.push({
        capability: 'fonts',
        key: name,
        reason: 'manifest에 선언된(managed) 항목은 삭제 대상이 아님 — 먼저 일시중지(ignore)하세요'
      })
      continue
    }
    if (!ignore.has(name)) {
      excluded.push({
        capability: 'fonts',
        key: name,
        reason: '일시중지(ignore)되지 않은 항목은 삭제 대상이 아님'
      })
      continue
    }
    const files = resolvedByName.get(name)
    if (!files || files.length === 0) {
      excluded.push({ capability: 'fonts', key: name, reason: '이 머신에 설치돼 있지 않음' })
      continue
    }
    const fullPaths = locateFontFiles(ctx, files)
    if (fullPaths.length === 0) {
      excluded.push({
        capability: 'fonts',
        key: name,
        reason: '레지스트리엔 매칭됐지만 실제 파일 경로를 찾지 못함'
      })
      continue
    }
    actions.push(makeFontUninstallAction(ctx, name, fullPaths, systemProvider, runTs))
  }

  return { actions, excluded }
}
