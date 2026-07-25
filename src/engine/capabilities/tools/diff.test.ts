import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { diffTools } from './diff'
import { TOOLS_LAYER } from './constants'
import { makeFakeToolsProvider } from './testHelpers'

// 케이스 출처: 구 repo tests/test_tools_plan.py TestDiffToolsNodeAutomation
// (4케이스, 행동만 옮김 -- 코드 복사 아님).

function writeToolsManifest(
  ctx: Parameters<typeof writeCommonLayer>[0],
  packages: readonly string[] = ['pnpm'],
  nodeVersion = 'v25.8.1'
): void {
  writeCommonLayer(ctx, TOOLS_LAYER, {
    packages: [...packages].sort(),
    node: { version: nodeVersion, manager: 'nvm' }
  })
}

describe('diffTools', () => {
  it('test_fresh_machine_no_node_no_nvm', async () => {
    const fixture = makeFixture('reference')
    writeToolsManifest(fixture.ctx)
    const provider = makeFakeToolsProvider({ available: false })
    const d = await diffTools(fixture.ctx, provider)
    expect(d.skipped).toBe(false)
    expect(d.toInstall).toEqual(['pnpm'])
    expect(d.nodeToInstall).toBe('v25.8.1')
    expect(d.nvmMissing).toBe(true)
    fixture.cleanup()
  })

  it('test_node_version_mismatch_with_nvm_present', async () => {
    const fixture = makeFixture('reference', {})
    writeToolsManifest(fixture.ctx, [])
    fs.mkdirSync(path.join(fixture.ctx.homeDir, '.nvm'), { recursive: true })
    const provider = makeFakeToolsProvider({ available: true, globals: {}, nodeVersion: 'v24.0.0' })
    const d = await diffTools(fixture.ctx, provider)
    expect(d.nodeToInstall).toBe('v25.8.1')
    expect(d.nvmMissing).toBe(false)
    fixture.cleanup()
  })

  it('test_in_sync', async () => {
    const fixture = makeFixture('reference')
    writeToolsManifest(fixture.ctx)
    const provider = makeFakeToolsProvider({
      available: true,
      globals: { pnpm: '10' },
      nodeVersion: 'v25.8.1'
    })
    const d = await diffTools(fixture.ctx, provider)
    expect(d.toInstall).toEqual([])
    expect(d.nodeToInstall).toBeNull()
    expect(d.nvmMissing).toBe(false)
    fixture.cleanup()
  })

  it('test_skips_when_no_node_declared_and_no_npm', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, TOOLS_LAYER, { packages: ['pnpm'] })
    const provider = makeFakeToolsProvider({ available: false })
    const d = await diffTools(fixture.ctx, provider)
    expect(d.skipped).toBe(true)
    fixture.cleanup()
  })
})
