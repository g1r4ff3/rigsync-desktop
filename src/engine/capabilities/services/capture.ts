/**
 * services capture — 구 repo `capture_services`(rigsync.py:1542) 행동 이식.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { SERVICES_LAYER } from './constants'
import type { SystemdUserProvider } from './providerTypes'
import type { ServicesCaptureReport, ServicesManifest, ServiceUnitEntry } from './types'

export class FollowerServicesCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerServicesCaptureBlockedError'
  }
}

export interface CaptureServicesOptions {
  readonly dryRun: boolean
}

export async function captureServices(
  ctx: RigsyncContext,
  provider: SystemdUserProvider,
  options: CaptureServicesOptions
): Promise<ServicesCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerServicesCaptureBlockedError()
  }

  const existing = (readCommonLayer(ctx, SERVICES_LAYER) as ServicesManifest).unit ?? []
  const entries = new Map<string, ServiceUnitEntry>(existing.map((u) => [u.name, u]))
  const outDir = path.join(ctx.manifestDir, 'services', 'systemd-user')

  for (const u of provider.listUnitFiles()) {
    const enabled = provider.isEnabled(u.name)
    if (!options.dryRun) {
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, u.name), u.content)
    }
    entries.set(u.name, { name: u.name, file: `services/systemd-user/${u.name}`, enabled })
  }

  if (!options.dryRun) {
    writeCommonLayer(ctx, SERVICES_LAYER, entries.size > 0 ? { unit: [...entries.values()] } : {})
  }

  return { captured: entries.size }
}
