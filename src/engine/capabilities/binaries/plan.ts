/**
 * binaries plan — 좌표 해석 → 다운로드 → (asset 종류에 따라 압축 해제 또는
 * 그대로 배치) → installDir에 배치 → 실행 권한(0755) 부여. 전부 unprivileged
 * (홈 디렉터리 쓰기라 sudo 불필요 — fonts/appimage plan과 동일한 원칙).
 *
 * 멱등성: destDir에 이미 같은 이름의 실행파일이 있으면 덮어쓰기 전 백업
 * (불변식 ②, doBackup), diff.toInstall에 없는(=이미 올바르게 설치된) 엔트리는
 * 애초에 액션이 생기지 않는다(diff 단계에서 걸러짐).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import type { PlanAction } from '../../plan'
import { doBackup } from '../../safety/backup'
import { BINARIES_KEY_FIELDS, BINARIES_LAYER } from './constants'
import type {
  BinaryAssetResolver,
  BinaryDownloader,
  BinaryZipExtractor,
  TarExtractor
} from './providerTypes'
import { resolveBinariesInstallDir } from './scan'
import type { BinariesDiffReport, BinaryEntry } from './types'

function entriesByName(ctx: RigsyncContext): Map<string, BinaryEntry> {
  const manifest =
    (effectiveLayer(ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS).binary as
      BinaryEntry[] | undefined) ?? []
  return new Map(manifest.map((e) => [e.name, e]))
}

function makeInstallAction(
  ctx: RigsyncContext,
  entry: BinaryEntry,
  resolver: BinaryAssetResolver,
  downloader: BinaryDownloader,
  zipExtractor: BinaryZipExtractor,
  tarExtractor: TarExtractor,
  runTs: string
): PlanAction {
  const destDir = resolveBinariesInstallDir(ctx, entry.installDir)
  const source = entry.source

  return {
    capability: 'binaries',
    summary: `install ${entry.name} (${source.coordinate})`,
    commands: [
      `# ${source.coordinate}에서 "${source.assetPattern}" 패턴에 맞는 릴리스 asset 해석`,
      `# 다운로드해 ${destDir}/에 배치 후 실행 권한(0755) 부여`
    ],
    privileged: false,
    run: async () => {
      const asset = await resolver.resolveAsset(
        source.coordinate,
        source.assetPattern,
        entry.pin ?? null
      )
      if (!asset) {
        return {
          ok: false,
          detail: `"${source.assetPattern}" 패턴에 맞는 릴리스 asset을 찾지 못함`
        }
      }

      fs.mkdirSync(destDir, { recursive: true })
      for (const name of entry.binaries) {
        const existing = path.join(destDir, name)
        if (fs.existsSync(existing)) doBackup(ctx, existing, runTs)
      }

      const downloadDest = path.join(os.tmpdir(), `rigsync-binary-${Date.now()}-${asset.name}`)
      const downloadResult = await downloader.download(asset.downloadUrl, downloadDest)
      if (!downloadResult.ok) return { ok: false, detail: downloadResult.detail }

      const matchesDeclaredBinary = (entryName: string): boolean =>
        entry.binaries.includes(entryName)

      let installedPaths: readonly string[]
      let extractDetail: string | undefined

      if (source.assetKind === 'single-binary') {
        // asset 자체가 실행파일 하나 -- 선언된 이름(보통 하나) 그대로 배치한다.
        const targetName = entry.binaries[0] ?? asset.name
        const target = path.join(destDir, targetName)
        fs.copyFileSync(downloadDest, target)
        installedPaths = [target]
      } else if (source.assetKind === 'tar.gz') {
        const extracted = tarExtractor.extractGz(downloadDest, destDir, matchesDeclaredBinary)
        installedPaths = extracted.ok ? extracted.extractedPaths : []
        extractDetail = extracted.detail
        if (!extracted.ok) return { ok: false, detail: extractDetail ?? 'tar.gz 추출 실패' }
      } else if (source.assetKind === 'tar.bz2') {
        const extracted = tarExtractor.extractBz2(downloadDest, destDir, matchesDeclaredBinary)
        installedPaths = extracted.ok ? extracted.extractedPaths : []
        extractDetail = extracted.detail
        if (!extracted.ok) return { ok: false, detail: extractDetail ?? 'tar.bz2 추출 실패' }
      } else {
        const extracted = zipExtractor.extract(downloadDest, destDir, matchesDeclaredBinary)
        installedPaths = extracted.ok ? extracted.extractedPaths : []
        extractDetail = extracted.detail
        if (!extracted.ok) return { ok: false, detail: extractDetail ?? 'zip 추출 실패' }
      }

      if (installedPaths.length === 0) {
        return {
          ok: false,
          detail: `asset 안에서 실행파일(${entry.binaries.join(', ')})을 찾지 못함`
        }
      }

      // 실행 권한 부여 -- 단독 바이너리 다운로드든 압축 해제 결과든 동일하게
      // 여기서 한 번에 처리한다(코디네이터 지시: "추출 후 실행 권한 부여 필수").
      for (const installedPath of installedPaths) {
        fs.chmodSync(installedPath, 0o755)
      }

      return { ok: true, detail: `설치 완료: ${entry.name} -> ${destDir}` }
    }
  }
}

export function planBinaries(
  ctx: RigsyncContext,
  diff: BinariesDiffReport,
  resolver: BinaryAssetResolver,
  downloader: BinaryDownloader,
  zipExtractor: BinaryZipExtractor,
  tarExtractor: TarExtractor,
  runTs: string
): PlanAction[] {
  const byName = entriesByName(ctx)
  const actions: PlanAction[] = []
  for (const name of diff.toInstall) {
    const entry = byName.get(name)
    if (!entry) continue
    actions.push(
      makeInstallAction(ctx, entry, resolver, downloader, zipExtractor, tarExtractor, runTs)
    )
  }
  return actions
}
