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
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import type { PlanAction } from '../../plan'
import { doBackup } from '../../safety/backup'
import type { CapabilityUninstallResult, UninstallExclusion } from '../../uninstall/types'
import { BINARIES_KEY_FIELDS, BINARIES_LAYER } from './constants'
import type {
  BinaryAssetResolver,
  BinaryDownloader,
  BinaryZipExtractor,
  TarExtractor
} from './providerTypes'
import {
  defaultBinariesInstallDir,
  groupInstalledBinaries,
  resolveBinariesInstallDir
} from './scan'
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
        const extracted = await tarExtractor.extractGz(downloadDest, destDir, matchesDeclaredBinary)
        installedPaths = extracted.ok ? extracted.extractedPaths : []
        extractDetail = extracted.detail
        if (!extracted.ok) return { ok: false, detail: extractDetail ?? 'tar.gz 추출 실패' }
      } else if (source.assetKind === 'tar.bz2') {
        const extracted = await tarExtractor.extractBz2(
          downloadDest,
          destDir,
          matchesDeclaredBinary
        )
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

/**
 * name 하나의 실행파일들(files, installDir 기준 파일명)을 지우는 액션 —
 * 불변식 ②에 따라 파일마다 백업 후 삭제한다.
 */
function makeBinaryUninstallAction(
  ctx: RigsyncContext,
  name: string,
  installDir: string,
  files: readonly string[],
  runTs: string
): PlanAction {
  const paths = files.map((f) => path.join(installDir, f))
  const commands = paths.flatMap((p) => [`backup ${p}`, `rm ${p}`])
  return {
    capability: 'binaries',
    summary: `uninstall ${name}`,
    commands,
    privileged: false,
    run: async () => {
      for (const p of paths) {
        if (fs.existsSync(p)) {
          doBackup(ctx, p, runTs)
          fs.unlinkSync(p)
        }
      }
      return { ok: true, detail: `삭제 완료: ${name} (${files.join(', ')})` }
    }
  }
}

/**
 * binaries uninstall 계획 — 안전 불변식 5: manifest에 선언된(managed) 항목은
 * 거부하고, ignore(일시중지)되지 않은 항목도 거부한다. 유효 대상(managed=false)
 * 은 manifest entry의 installDir를 알 수 없으므로 항상 기본 설치 디렉터리
 * (`~/.local/bin`)를 스캔한다 — 이 계약이 성립하는 이유: managed=false인
 * 이상 이 이름은 애초에 커스텀 installDir을 선언한 manifest entry를 가진
 * 적이 없거나(늘 기본값 사용) 이미 capture로 제거됐다(그 경우도 재설치 때는
 * 기본 경로만 쓰인다 — fonts capability와 동일 원칙).
 */
export function planBinariesUninstall(
  ctx: RigsyncContext,
  requestedNames: readonly string[],
  runTs: string
): CapabilityUninstallResult {
  const manifest =
    (effectiveLayer(ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS).binary as
      BinaryEntry[] | undefined) ?? []
  const managedSet = new Set(manifest.map((e) => e.name))
  const ignore = readIgnoreSet(ctx, 'binaries', 'names')
  const installDir = defaultBinariesInstallDir(ctx)
  const { resolvedByName } = groupInstalledBinaries(ctx, installDir)

  const actions: PlanAction[] = []
  const excluded: UninstallExclusion[] = []

  for (const name of requestedNames) {
    if (managedSet.has(name)) {
      excluded.push({
        capability: 'binaries',
        key: name,
        reason: 'manifest에 선언된(managed) 항목은 삭제 대상이 아님 — 먼저 일시중지(ignore)하세요'
      })
      continue
    }
    if (!ignore.has(name)) {
      excluded.push({
        capability: 'binaries',
        key: name,
        reason: '일시중지(ignore)되지 않은 항목은 삭제 대상이 아님'
      })
      continue
    }
    const files = resolvedByName.get(name)
    if (!files || files.length === 0) {
      excluded.push({ capability: 'binaries', key: name, reason: '이 머신에 설치돼 있지 않음' })
      continue
    }
    actions.push(makeBinaryUninstallAction(ctx, name, installDir, files, runTs))
  }

  return { actions, excluded }
}
