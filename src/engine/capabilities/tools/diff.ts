/**
 * tools diff — 구 repo `diff_tools`(rigsync.py:1046) 행동 이식. node 자체가 이
 * 레이어의 관리 대상이라(manifest의 `[node]` 버전이 수렴 목표) npm/node가 없는
 * 신규 머신에서도 manifest에 node 버전이 선언돼 있으면 skip하지 않는다 — apply가
 * nvm→node→globals 체인 전체를 부트스트랩할 수 있어야 하기 때문(구 repo 결정 그대로).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import { TOOLS_LAYER } from './constants'
import type { ToolsProvider } from './providerTypes'
import type { ToolsDiffReport, ToolsManifest } from './types'

export async function diffTools(
  ctx: RigsyncContext,
  provider: ToolsProvider
): Promise<ToolsDiffReport> {
  const manifest = effectiveLayer(ctx, TOOLS_LAYER) as ToolsManifest
  const ignore = readIgnoreSet(ctx, 'tools', 'packages')
  const wantPkgs = [...new Set(manifest.packages ?? [])].filter((p) => !ignore.has(p)).sort()
  const wantNode = manifest.node?.version ?? ''
  const npmOk = await provider.npmNodeAvailable()

  if (!npmOk && !wantNode) {
    return {
      skipped: true,
      toInstall: [],
      nodeToInstall: null,
      nvmMissing: false,
      note: 'npm/node not found on PATH and no node version in manifest -- skipping'
    }
  }

  let toInstall: string[]
  let nodeToInstall: string | null
  if (npmOk) {
    const installed = new Set(Object.keys(await provider.npmGlobals()))
    const liveNode = await provider.nodeVersion()
    toInstall = wantPkgs.filter((p) => !installed.has(p))
    nodeToInstall = wantNode && liveNode !== wantNode ? wantNode : null
  } else {
    toInstall = wantPkgs
    nodeToInstall = wantNode || null
  }

  const nvmDirExists = fs.existsSync(path.join(ctx.homeDir, '.nvm'))
  const nvmMissing = !nvmDirExists && nodeToInstall !== null

  return { skipped: false, toInstall, nodeToInstall, nvmMissing }
}
