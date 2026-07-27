/**
 * appimage capture — Gear Lever의 `--list-installed --json` + `gearlever.conf`
 * INI(읽기 전용)를 조인해 삼중항(source·coordinate·repoFilename)을 완성하고
 * manifest에 additive-only로 기록한다. FORWARD.md §7 실측 반영.
 *
 * - role='follower'면 거부 (불변식 ⑦, 다른 capability와 동일).
 * - `pin`은 capture가 절대 건드리지 않는다 — 사용자가 명시적으로 고정한
 *   값이므로 재캡처해도 그대로 보존한다(없으면 null=최신 추적).
 * - update manager 좌표(repo/repo_filename)를 gearlever.conf에서 못 찾으면
 *   (예: 아직 업데이트 소스를 지정 안 한 AppImage) manifest에 안 넣고 note로
 *   남긴다 — 재현 불가능한 엔트리를 담지 않는다.
 */
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer, type ManifestDocument } from '../../manifest'
import { APPIMAGE_LAYER } from './constants'
import type { GearLeverProvider } from './providerTypes'
import type { AppimageCaptureReport, AppimageEntry, UpdateManagerModel } from './types'

export class FollowerAppimageCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerAppimageCaptureBlockedError'
  }
}

export interface CaptureAppimageOptions {
  readonly dryRun: boolean
}

const KNOWN_MANAGERS: readonly UpdateManagerModel[] = [
  'StaticFileUpdater',
  'GithubUpdater',
  'GitlabUpdater',
  'CodebergUpdater',
  'FTPUpdater',
  'ForgejoUpdater'
]

function isKnownManager(value: string): value is UpdateManagerModel {
  return (KNOWN_MANAGERS as readonly string[]).includes(value)
}

function readExistingEntries(ctx: Pick<RigsyncContext, 'manifestDir'>): AppimageEntry[] {
  const doc = readCommonLayer(ctx, APPIMAGE_LAYER)
  return (doc.app as AppimageEntry[] | undefined) ?? []
}

export async function captureAppimage(
  ctx: RigsyncContext,
  provider: GearLeverProvider,
  options: CaptureAppimageOptions
): Promise<AppimageCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerAppimageCaptureBlockedError()
  }

  if (!(await provider.isAvailable())) {
    return {
      skipped: true,
      capturedCount: 0,
      added: 0,
      notes: ['Gear Lever(it.mijorus.gearlever)를 찾을 수 없음 -- skip']
    }
  }

  const existingMap = new Map<string, AppimageEntry>(
    readExistingEntries(ctx).map((e) => [e.name, e])
  )
  const notes: string[] = []
  let added = 0

  for (const row of await provider.listInstalled()) {
    const config = provider.readAppConfig(row.path)
    const repo = config?.updateManager?.repo
    const repoFilename = config?.updateManager?.repoFilename
    const managerRaw = config?.updateManager?.manager ?? row.manager

    if (!repo || !repoFilename || !managerRaw) {
      notes.push(`${row.desktopId}: gearlever.conf에서 update source 좌표를 찾지 못함 -- 건너뜀`)
      continue
    }
    if (!isKnownManager(managerRaw)) {
      notes.push(`${row.desktopId}: 알 수 없는 manager "${managerRaw}" -- 건너뜀`)
      continue
    }

    const prior = existingMap.get(row.desktopId)
    const entry: AppimageEntry = {
      name: row.desktopId,
      source: managerRaw,
      coordinate: repo,
      repoFilename,
      // TOML엔 null이 없다 -- pin이 없으면 키 자체를 생략한다(round-trip하면
      // 어차피 undefined가 되므로 처음부터 그렇게 쓴다). 있으면(사용자가 건
      // 상태) 보존한다.
      ...(prior?.pin ? { pin: prior.pin } : {})
    }
    if (!existingMap.has(row.desktopId)) added += 1
    existingMap.set(row.desktopId, entry)
  }

  if (!options.dryRun) {
    const data: ManifestDocument = existingMap.size > 0 ? { app: [...existingMap.values()] } : {}
    writeCommonLayer(ctx, APPIMAGE_LAYER, data)
  }

  return { skipped: false, capturedCount: existingMap.size, added, notes }
}
