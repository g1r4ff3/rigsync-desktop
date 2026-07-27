/**
 * tools capture — 구 repo `capture_tools`(rigsync.py:1028) 행동 이식.
 */
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { TOOLS_LAYER } from './constants'
import type { ToolsProvider } from './providerTypes'
import type { ToolsCaptureReport, ToolsManifest } from './types'

export class FollowerToolsCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerToolsCaptureBlockedError'
  }
}

export interface CaptureToolsOptions {
  readonly dryRun: boolean
}

export async function captureTools(
  ctx: RigsyncContext,
  provider: ToolsProvider,
  options: CaptureToolsOptions
): Promise<ToolsCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerToolsCaptureBlockedError()
  }
  if (!(await provider.npmNodeAvailable())) {
    return {
      skipped: true,
      packagesInManifest: 0,
      added: 0,
      nodeVersion: null,
      note: 'npm/node not found on PATH -- skipping (see doctor node-nvm hint)'
    }
  }

  const globals = await provider.npmGlobals()
  const nodeVersion = await provider.nodeVersion()
  const existing = (readCommonLayer(ctx, TOOLS_LAYER) as ToolsManifest).packages ?? []
  const ignore = readIgnoreSet(ctx, 'tools', 'packages')
  const existingPackages = new Set(existing.filter((p) => !ignore.has(p)))
  const newPackages = [...new Set([...existingPackages, ...Object.keys(globals)])]
    .filter((p) => !ignore.has(p))
    .sort()

  if (!options.dryRun) {
    writeCommonLayer(ctx, TOOLS_LAYER, {
      packages: newPackages,
      node: { version: nodeVersion, manager: 'nvm' }
    })
  }

  return {
    skipped: false,
    packagesInManifest: newPackages.length,
    added: newPackages.filter((p) => !existingPackages.has(p)).length,
    nodeVersion
  }
}
