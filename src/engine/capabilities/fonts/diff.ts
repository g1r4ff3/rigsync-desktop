/**
 * fonts diff — manifest(effective) vs 실제 설치된 폰트 파일. dotfiles/appimage
 * diff와 동일한 순수 읽기 전용 원칙. 폰트 디렉터리 스캔은 provider 뒤가 아니라
 * ctx.homeDir 기준 순수 fs라(scan.ts) diffAppimage와 달리 provider 인자가
 * 없다 — diffDotfiles(ctx)와 동일한 시그니처.
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
  // "설치돼 있는지"는 레지스트리 식별 여부와 무관하게 전체 스캔 결과로
  // 판정한다(manifest가 과거에 캡처한 파일명이 지금 레지스트리 패턴과 어긋나도
  // 실제 파일 존재는 존재다) — uncaptured만 레지스트리 식별 결과를 쓴다.
  const installedFilenames = new Set(scanInstalledFontFiles(ctx))
  const { resolvedByName } = groupInstalledFontFiles(ctx)
  const manifestNames = new Set(manifest.map((e) => e.name))

  const toInstall: string[] = []
  const pinMismatch: FontsPinMismatch[] = []

  for (const entry of manifest) {
    const missing = entry.files.filter((f) => !installedFilenames.has(f))
    if (missing.length > 0) {
      toInstall.push(entry.name)
      continue
    }
    if (entry.pin) {
      const def = getKnownFontDefinition(entry.name)
      if (def?.extractVersion) {
        for (const file of entry.files) {
          const version = def.extractVersion(file)
          if (version && version !== entry.pin) {
            pinMismatch.push({ name: entry.name, pinned: entry.pin, installedVersion: version })
            break
          }
        }
      }
    }
  }

  const uncaptured = [...resolvedByName.keys()].filter((name) => !manifestNames.has(name)).sort()

  return { toInstall, pinMismatch, uncaptured }
}
