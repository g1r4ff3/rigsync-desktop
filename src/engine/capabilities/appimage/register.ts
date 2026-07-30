/**
 * appimage 단건 등록 리졸버 — WS4("창고 모델 1차") `registry.ts`가 호출한다.
 * `capture.ts`의 `resolveAppimageUpdateSource`(gearlever.conf 좌표 해석)를
 * 그대로 재사용해 이 머신에 설치된 항목 하나만 common 계층에 upsert한다.
 */
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer, type ManifestDocument } from '../../manifest'
import { resolveAppimageUpdateSource } from './capture'
import { APPIMAGE_LAYER } from './constants'
import type { GearLeverProvider } from './providerTypes'
import type { AppimageEntry } from './types'

export class AppimageEntryNotInstalledError extends Error {
  constructor(readonly desktopId: string) {
    super(`${desktopId}: 이 머신에 설치돼 있지 않음(Gear Lever 미통합)`)
    this.name = 'AppimageEntryNotInstalledError'
  }
}

/** 좌표를 추정하지 않는다(CLAUDE.md 정신) — gearlever.conf에 없으면 그대로 에러로 표면화. */
export class AppimageUpdateSourceUnresolvedError extends Error {
  constructor(
    readonly desktopId: string,
    readonly reason: string
  ) {
    super(`${desktopId}: ${reason}`)
    this.name = 'AppimageUpdateSourceUnresolvedError'
  }
}

function readExistingEntries(ctx: Pick<RigsyncContext, 'manifestDir'>): AppimageEntry[] {
  const doc = readCommonLayer(ctx, APPIMAGE_LAYER)
  return (doc.app as AppimageEntry[] | undefined) ?? []
}

export async function registerAppimageEntry(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  provider: GearLeverProvider,
  desktopId: string
): Promise<void> {
  const row = (await provider.listInstalled()).find((r) => r.desktopId === desktopId)
  if (!row) throw new AppimageEntryNotInstalledError(desktopId)

  const resolved = resolveAppimageUpdateSource(provider, row)
  if (!resolved.ok) throw new AppimageUpdateSourceUnresolvedError(desktopId, resolved.reason)

  const entries = new Map<string, AppimageEntry>(readExistingEntries(ctx).map((e) => [e.name, e]))
  const prior = entries.get(desktopId)
  entries.set(desktopId, {
    name: desktopId,
    source: resolved.manager,
    coordinate: resolved.coordinate,
    repoFilename: resolved.repoFilename,
    ...(prior?.pin ? { pin: prior.pin } : {})
  })

  const data: ManifestDocument = { app: [...entries.values()] }
  writeCommonLayer(ctx, APPIMAGE_LAYER, data)
}
