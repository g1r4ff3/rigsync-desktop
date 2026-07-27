/**
 * fonts capture — 설치된 폰트 파일을 스캔하고, 알려진 레지스트리
 * (`knownFontSources.ts`)로 소스 좌표를 해석해 manifest에 additive-only로
 * 기록한다. dotfiles/appimage capture와 동일한 안전선:
 *
 * - role='follower'면 거부 (불변식 ⑦).
 * - `files`는 capture가 실제로 찾은 파일명 그대로 기록한다(하드코딩된 "이상적"
 *   목록이 아니다 — github-release 소스는 파일명 자체가 버전을 담고 있어
 *   실측만이 진실이다).
 * - `pin`은 capture가 절대 건드리지 않는다 — 사용자가 수동으로 건 값만
 *   재캡처해도 보존한다(appimage capture와 동일한 계약).
 * - 레지스트리에 없는 파일(소스 미지정)은 manifest에 담지 않고 note로 남긴다
 *   — 재현 불가능한 엔트리를 담지 않는다(추측 금지, 코디네이터 지시).
 */
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer, type ManifestDocument } from '../../manifest'
import { isVersionedFilename, VERSIONED_FILENAME_WARNING } from '../../versionedFilename'
import { FONTS_LAYER } from './constants'
import { getKnownFontDefinition } from './knownFontSources'
import { groupInstalledFontFiles } from './scan'
import type { FontEntry, FontsCaptureReport } from './types'

export class FollowerFontsCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerFontsCaptureBlockedError'
  }
}

export interface CaptureFontsOptions {
  readonly dryRun: boolean
}

function readExistingEntries(ctx: Pick<RigsyncContext, 'manifestDir'>): FontEntry[] {
  const doc = readCommonLayer(ctx, FONTS_LAYER)
  return (doc.font as FontEntry[] | undefined) ?? []
}

export async function captureFonts(
  ctx: RigsyncContext,
  options: CaptureFontsOptions
): Promise<FontsCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerFontsCaptureBlockedError()
  }

  const existingEntries = readExistingEntries(ctx)
  const existingMap = new Map<string, FontEntry>(existingEntries.map((e) => [e.name, e]))
  const { resolvedByName, unresolvedFiles } = groupInstalledFontFiles(ctx, existingEntries)
  const notes: string[] = []
  let added = 0

  for (const [name, files] of resolvedByName) {
    const prior = existingMap.get(name)
    const knownSource = getKnownFontDefinition(name)?.source ?? null
    if (!knownSource) {
      // 이론상 groupInstalledFontFiles가 이미 레지스트리로 걸러줬으니 도달하지
      // 않지만, 방어적으로 남겨 "추측으로 채우지 않는다" 원칙을 지킨다.
      notes.push(`${name}: 레지스트리에서 소스를 다시 찾지 못함 -- 건너뜀`)
      continue
    }
    const entry: FontEntry = {
      name,
      source: knownSource,
      files: [...files].sort(),
      ...(prior?.pin ? { pin: prior.pin } : {})
    }
    if (!existingMap.has(name)) added += 1
    existingMap.set(name, entry)
  }

  for (const file of unresolvedFiles) {
    // refactor-spec-v0.2 F5 -- 미등록 + 버전성 파일명이면 소스를 지정하기
    // 전까지 다른 머신에서 영원히 파일명이 일치하지 않을 수 있다는 것까지
    // 함께 경고한다(단순 "레지스트리에 없음"보다 구체적인 위험).
    const suffix = isVersionedFilename(file) ? ` -- ${VERSIONED_FILENAME_WARNING}` : ''
    notes.push(
      `${file}: 알려진 폰트 레지스트리에 없어 소스를 특정할 수 없음 -- manifest에 담지 않음${suffix}`
    )
  }

  if (!options.dryRun) {
    const data: ManifestDocument = existingMap.size > 0 ? { font: [...existingMap.values()] } : {}
    writeCommonLayer(ctx, FONTS_LAYER, data)
  }

  return { capturedCount: existingMap.size, added, notes }
}
