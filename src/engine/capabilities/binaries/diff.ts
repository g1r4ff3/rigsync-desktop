/**
 * binaries diff — manifest(effective) vs 실제 `~/.local/bin`(또는 entry별
 * installDir) 상태. fonts diff와 달리 **variant 단위 판정이 필요 없다** —
 * 실행파일 이름(uv, uvx, micromamba)은 버전이 바뀌어도 파일명이 그대로라
 * (fonts의 D2Coding처럼 release asset 파일명에 버전이 박히는 문제가 없다),
 * 정확한 이름 존재 여부만 확인하면 구조적으로 수렴한다. pin이 걸린 경우만
 * 별도로 실행해서 버전을 확인한다(diffAppimage와 같은 원칙 — 설치 확인은
 * 존재만으로 충분하고, 버전 확인은 pin이 있을 때만 필요한 추가 비용이라 분리).
 */
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import { isSubscribed, readSelectionFilter } from '../../selection'
import { BINARIES_KEY_FIELDS, BINARIES_LAYER } from './constants'
import { getKnownBinaryDefinition } from './knownBinarySources'
import type { BinariesSystemProvider } from './providerTypes'
import { groupInstalledBinaries, isExecutableFile, resolveBinariesInstallDir } from './scan'
import type { BinariesDiffReport, BinariesPinMismatch, BinaryEntry } from './types'

export async function diffBinaries(
  ctx: RigsyncContext,
  systemProvider: BinariesSystemProvider
): Promise<BinariesDiffReport> {
  const manifest =
    (effectiveLayer(ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS).binary as
      BinaryEntry[] | undefined) ?? []
  // WS2("창고 모델" 구독 강제): 안전 규칙 1 — 미구독 엔트리는 설치/드리프트
  // 판정만 skip한다.
  const selection = readSelectionFilter(ctx, 'binaries')

  const toInstall: string[] = []
  const pinMismatch: BinariesPinMismatch[] = []

  for (const entry of manifest) {
    if (!isSubscribed(selection, entry.name)) continue
    const dir = resolveBinariesInstallDir(ctx, entry.installDir)
    const missing = entry.binaries.filter((name) => !isExecutableFile(path.join(dir, name)))
    if (missing.length > 0) {
      toInstall.push(entry.name)
      continue
    }

    if (entry.pin) {
      const def = getKnownBinaryDefinition(entry.name)
      if (def) {
        for (const binaryName of entry.binaries) {
          const result = await systemProvider.runVersionCommand(
            path.join(dir, binaryName),
            def.versionArgs
          )
          const version = result.ok ? def.parseVersion(result.output) : null
          if (version && version !== entry.pin) {
            pinMismatch.push({ name: entry.name, pinned: entry.pin, installedVersion: version })
            break
          }
        }
      }
    }
  }

  const manifestNames = new Set(manifest.map((e) => e.name))
  const { resolvedByName } = groupInstalledBinaries(ctx)
  const uncaptured = [...resolvedByName.keys()].filter((name) => !manifestNames.has(name)).sort()

  return { toInstall, pinMismatch, uncaptured }
}
