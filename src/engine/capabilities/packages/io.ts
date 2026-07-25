/**
 * packages.toml 하나를 apt/snap/flatpak 세 provider가 나눠 쓰기 위한 아주 얇은
 * 읽기/쓰기 헬퍼. 한 provider의 캡처가 다른 provider의 섹션을 지우지 않도록
 * 항상 "전체 문서를 읽고 → 자기 키만 갈아끼우고 → 전체 문서를 다시 쓴다".
 */
import { effectiveLayer, readCommonLayer, writeCommonLayer } from '../../manifest'
import type { RigsyncContext } from '../../context'
import { PACKAGES_KEY_FIELDS, PACKAGES_LAYER } from './constants'
import type { AptSection, FlatpakSection, PackagesManifest, SnapSection } from './types'

export function readEffectivePackages(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>
): PackagesManifest {
  return effectiveLayer(ctx, PACKAGES_LAYER, PACKAGES_KEY_FIELDS) as PackagesManifest
}

export function readCommonPackages(ctx: Pick<RigsyncContext, 'manifestDir'>): PackagesManifest {
  return readCommonLayer(ctx, PACKAGES_LAYER) as PackagesManifest
}

export function writeCommonAptSection(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  apt: AptSection
): void {
  const doc = readCommonPackages(ctx)
  writeCommonLayer(ctx, PACKAGES_LAYER, { ...doc, apt })
}

export function writeCommonSnapSection(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  snap: SnapSection
): void {
  const doc = readCommonPackages(ctx)
  writeCommonLayer(ctx, PACKAGES_LAYER, { ...doc, snap })
}

export function writeCommonFlatpakSection(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  flatpak: FlatpakSection
): void {
  const doc = readCommonPackages(ctx)
  writeCommonLayer(ctx, PACKAGES_LAYER, { ...doc, flatpak })
}
