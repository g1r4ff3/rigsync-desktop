/**
 * fonts diff — manifest(effective) vs 실제 설치된 폰트 파일. dotfiles/appimage
 * diff와 동일한 순수 읽기 전용 원칙. 폰트 디렉터리 스캔은 provider 뒤가 아니라
 * ctx.homeDir 기준 순수 fs라(scan.ts) diffAppimage와 달리 provider 인자가
 * 없다 — diffDotfiles(ctx)와 동일한 시그니처.
 *
 * **설치 판정 = 정확 일치 OR variant 일치** (실사용 버그 수정,
 * 2026-07-26/27): manifest의 `files`는 캡처 시점에 실제로 발견한 파일명
 * 그대로라 github-release 소스(예: D2Coding)는 release가 항상 최신을
 * 내려주는 이상 파일명의 버전이 매번 달라진다 — 정확한 파일명 일치만으로는
 * 이 소스 종류에서 구조적으로 영원히 수렴하지 않는다. 그래서 레지스트리에
 * 등록된 폰트도, 선언된 각 파일이 (a) 실제 설치 파일명과 정확히 일치하거나
 * (b) `variantKey`(버전을 뺀 식별자) 기준으로 같은 variant가 설치돼 있으면
 * 설치된 것으로 본다. (a)는 하드코딩 레지스트리 패턴이 아직 인식 못 하는
 * 파일 종류(예: D2Coding의 .ttc·-ligature 변종)라도 manifest에 이미 정확한
 * 파일명으로 선언·설치돼 있으면 오탐하지 않기 위함이고, (b)는 release 버전
 * drift에 수렴하기 위함이다. `pin`이 걸려 있을 때만 별도로 정확한 버전
 * 일치를 확인한다(pin의 의미가 "버전을 고정한다"인 이상 이 값은 여전히
 * 유지돼야 한다). 레지스트리에 없는(미지 소스) 항목은 variant 판정을 할
 * 근거(정규식)가 없으므로 기존처럼 선언된 `files` 정확 일치로만 판정한다.
 */
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import { FONTS_KEY_FIELDS, FONTS_LAYER } from './constants'
import { getKnownFontDefinition } from './knownFontSources'
import { groupInstalledFontFiles, scanInstalledFontFiles } from './scan'
import type { FontEntry, FontsDiffReport, FontsPinMismatch } from './types'

export async function diffFonts(ctx: RigsyncContext): Promise<FontsDiffReport> {
  const manifest =
    (effectiveLayer(ctx, FONTS_LAYER, FONTS_KEY_FIELDS).font as FontEntry[] | undefined) ?? []
  const installedFilenames = new Set(scanInstalledFontFiles(ctx))
  const { resolvedByName } = groupInstalledFontFiles(ctx, manifest)
  const manifestNames = new Set(manifest.map((e) => e.name))

  const toInstall: string[] = []
  const pinMismatch: FontsPinMismatch[] = []

  for (const entry of manifest) {
    const def = getKnownFontDefinition(entry.name)

    if (!def) {
      // 레지스트리 밖 항목 -- variant를 판정할 정규식이 없어 선언된 files
      // 정확 일치로 폴백한다(기존 동작 그대로).
      const missing = entry.files.filter((f) => !installedFilenames.has(f))
      if (missing.length > 0) toInstall.push(entry.name)
      continue
    }

    const variantKeyOf = def.variantKey ?? ((f: string) => f)
    const installedFilesForFamily = resolvedByName.get(entry.name) ?? []
    const installedVariants = new Set(installedFilesForFamily.map(variantKeyOf))
    const missing = entry.files.filter(
      (f) => !installedFilenames.has(f) && !installedVariants.has(variantKeyOf(f))
    )
    if (missing.length > 0) {
      toInstall.push(entry.name)
      continue
    }

    if (entry.pin && def.extractVersion) {
      for (const file of installedFilesForFamily) {
        const version = def.extractVersion(file)
        if (version && version !== entry.pin) {
          pinMismatch.push({ name: entry.name, pinned: entry.pin, installedVersion: version })
          break
        }
      }
    }
  }

  const uncaptured = [...resolvedByName.keys()].filter((name) => !manifestNames.has(name)).sort()

  return { toInstall, pinMismatch, uncaptured }
}
