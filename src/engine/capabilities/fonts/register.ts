/**
 * fonts 단건 등록 리졸버 — WS4("창고 모델 1차") `registry.ts`가 호출한다.
 * `scan.ts`의 `groupInstalledFontFiles`(설치 파일 → 레지스트리 판정)를
 * 재사용해 이 머신에 실제로 식별된 폰트 패밀리 하나만 common 계층에
 * upsert한다. 레지스트리(`knownFontSources.ts`)에 없는 이름은 좌표를
 * 추정하지 않고 명시 에러로 거부한다(CLAUDE.md 정신 — capture.ts의
 * "재현 불가능한 엔트리를 담지 않는다" 원칙과 동일).
 */
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer, type ManifestDocument } from '../../manifest'
import { FONTS_LAYER } from './constants'
import { getKnownFontDefinition } from './knownFontSources'
import { groupInstalledFontFiles } from './scan'
import type { FontEntry } from './types'

export class FontSourceUnknownError extends Error {
  constructor(readonly name: string) {
    super(`${name}: 알려진 폰트 레지스트리에 없어 소스 좌표를 알 수 없음`)
    this.name = 'FontSourceUnknownError'
  }
}

function readExistingEntries(ctx: Pick<RigsyncContext, 'manifestDir'>): FontEntry[] {
  const doc = readCommonLayer(ctx, FONTS_LAYER)
  return (doc.font as FontEntry[] | undefined) ?? []
}

export function registerFontEntry(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'homeDir'>,
  name: string
): void {
  const existingEntries = readExistingEntries(ctx)
  const { resolvedByName } = groupInstalledFontFiles(ctx, existingEntries)
  const files = resolvedByName.get(name)
  const source = getKnownFontDefinition(name)?.source
  if (!files || !source) {
    throw new FontSourceUnknownError(name)
  }

  const existingMap = new Map<string, FontEntry>(existingEntries.map((e) => [e.name, e]))
  const prior = existingMap.get(name)
  existingMap.set(name, {
    name,
    source,
    files: [...files].sort(),
    ...(prior?.pin ? { pin: prior.pin } : {})
  })

  const data: ManifestDocument = { font: [...existingMap.values()] }
  writeCommonLayer(ctx, FONTS_LAYER, data)
}
