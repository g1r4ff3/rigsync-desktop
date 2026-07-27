/**
 * binaries capture — `~/.local/bin`(기본 설치 디렉터리)의 실행파일을 스캔하고,
 * 알려진 레지스트리(`knownBinarySources.ts`)로 소스 좌표를 해석해 manifest에
 * additive-only로 기록한다. fonts/appimage capture와 동일한 안전선:
 *
 * - role='follower'면 거부 (불변식 ⑦).
 * - `binaries`는 capture가 실제로 찾은 실행파일 이름 그대로 기록한다(레지스트리
 *   선언 전체가 아니라 — 일부만 설치돼 있으면 그 일부만).
 * - `pin`은 capture가 절대 건드리지 않는다 — 사용자가 수동으로 건 값만
 *   재캡처해도 보존한다(appimage/fonts capture와 동일한 계약).
 * - 레지스트리에 없는 실행파일(소스 미지정 — 사용자 스크립트 포함)은
 *   manifest에 담지 않고 note로 남긴다 — 재현 불가능한 엔트리를 담지 않는다
 *   (추측 금지, 코디네이터 지시).
 */
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer, type ManifestDocument } from '../../manifest'
import { isVersionedFilename, VERSIONED_FILENAME_WARNING } from '../../versionedFilename'
import { BINARIES_LAYER } from './constants'
import { getKnownBinaryDefinition } from './knownBinarySources'
import { groupInstalledBinaries } from './scan'
import type { BinariesCaptureReport, BinaryEntry } from './types'

export class FollowerBinariesCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerBinariesCaptureBlockedError'
  }
}

export interface CaptureBinariesOptions {
  readonly dryRun: boolean
}

function readExistingEntries(ctx: Pick<RigsyncContext, 'manifestDir'>): BinaryEntry[] {
  const doc = readCommonLayer(ctx, BINARIES_LAYER)
  return (doc.binary as BinaryEntry[] | undefined) ?? []
}

export async function captureBinaries(
  ctx: RigsyncContext,
  options: CaptureBinariesOptions
): Promise<BinariesCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerBinariesCaptureBlockedError()
  }

  const existingMap = new Map<string, BinaryEntry>(readExistingEntries(ctx).map((e) => [e.name, e]))
  const { resolvedByName, unresolvedFiles } = groupInstalledBinaries(ctx)
  const notes: string[] = []
  let added = 0

  for (const [name, files] of resolvedByName) {
    const prior = existingMap.get(name)
    const knownSource = getKnownBinaryDefinition(name)?.source ?? null
    if (!knownSource) {
      // 이론상 groupInstalledBinaries가 이미 레지스트리로 걸러줬으니 도달하지
      // 않지만, 방어적으로 남겨 "추측으로 채우지 않는다" 원칙을 지킨다.
      notes.push(`${name}: 레지스트리에서 소스를 다시 찾지 못함 -- 건너뜀`)
      continue
    }
    const entry: BinaryEntry = {
      name,
      source: knownSource,
      binaries: [...files].sort(),
      ...(prior?.pin ? { pin: prior.pin } : {})
    }
    if (!existingMap.has(name)) added += 1
    existingMap.set(name, entry)
  }

  for (const file of unresolvedFiles) {
    // refactor-spec-v0.2 F5 -- fonts capture.ts와 동일 판정: 미등록 + 버전성
    // 파일명이면 소스를 지정하기 전까지 다른 머신에서 영원히 일치하지 않을
    // 수 있다.
    const suffix = isVersionedFilename(file) ? ` -- ${VERSIONED_FILENAME_WARNING}` : ''
    notes.push(
      `${file}: 알려진 바이너리 레지스트리에 없어 소스를 특정할 수 없음 -- manifest에 담지 않음${suffix}`
    )
  }

  if (!options.dryRun) {
    const data: ManifestDocument = existingMap.size > 0 ? { binary: [...existingMap.values()] } : {}
    writeCommonLayer(ctx, BINARIES_LAYER, data)
  }

  return { capturedCount: existingMap.size, added, notes }
}
