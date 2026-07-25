import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { diffTools } from './diff'
import { planTools } from './plan'
import { TOOLS_LAYER, DEFAULT_NVM_VERSION } from './constants'
import { makeFakeToolsProvider } from './testHelpers'

// 케이스 출처: 구 repo tests/test_tools_plan.py TestPlanToolsNodeAutomation
// (4케이스, 행동만 옮김 -- 코드 복사 아님).

function writeToolsManifest(
  ctx: Parameters<typeof writeCommonLayer>[0],
  packages: readonly string[],
  nodeVersion = 'v25.8.1'
): void {
  writeCommonLayer(ctx, TOOLS_LAYER, {
    packages: [...packages].sort(),
    node: { version: nodeVersion, manager: 'nvm' }
  })
}

describe('planTools', () => {
  it('test_full_bootstrap_plan_when_nvm_missing -- order nvm -> node -> globals, all sudo-free', async () => {
    const fixture = makeFixture('reference')
    writeToolsManifest(fixture.ctx, ['pnpm', 'claude-mermaid'])
    const provider = makeFakeToolsProvider({ available: false })
    const diff = await diffTools(fixture.ctx, provider)
    const plan = planTools(fixture.ctx, provider, diff)

    const summaries = plan.map((a) => a.summary)
    expect(summaries[0]).toBe(`install nvm ${DEFAULT_NVM_VERSION}`)
    expect(summaries[1]).toBe('nvm install v25.8.1 (+ alias default)')
    expect(summaries.slice(2)).toEqual(['npm install -g claude-mermaid', 'npm install -g pnpm'])

    expect(plan[0].commands[0]).toContain(
      `https://raw.githubusercontent.com/nvm-sh/nvm/${DEFAULT_NVM_VERSION}/install.sh`
    )
    expect(plan[0].commands[0]).toContain('| bash')
    expect(plan[1].commands[0]).toContain('nvm install v25.8.1')
    expect(plan[1].commands[0]).toContain('nvm alias default v25.8.1')
    expect(plan[2].commands[0]).toContain('nvm.sh')

    for (const a of plan) {
      expect(a.privileged).toBeFalsy()
      for (const cmd of a.commands) expect(cmd.trim().startsWith('sudo')).toBe(false)
    }
    fixture.cleanup()
  })

  it('test_nvm_version_override_from_settings', async () => {
    const fixture = makeFixture('reference', { settings: { nvmVersion: 'v0.99.9' } })
    writeToolsManifest(fixture.ctx, [])
    const provider = makeFakeToolsProvider({ available: false })
    const diff = await diffTools(fixture.ctx, provider)
    const plan = planTools(fixture.ctx, provider, diff)
    expect(plan[0].commands[0]).toContain('v0.99.9')
    fixture.cleanup()
  })

  it('test_only_node_action_when_nvm_present', async () => {
    const fixture = makeFixture('reference')
    writeToolsManifest(fixture.ctx, [])
    fs.mkdirSync(path.join(fixture.ctx.homeDir, '.nvm'), { recursive: true })
    const provider = makeFakeToolsProvider({ available: true, globals: {}, nodeVersion: 'v24.0.0' })
    const diff = await diffTools(fixture.ctx, provider)
    const plan = planTools(fixture.ctx, provider, diff)
    expect(plan).toHaveLength(1)
    expect(plan[0].commands[0]).toContain('nvm install v25.8.1')
    fixture.cleanup()
  })

  it('test_empty_plan_when_in_sync', async () => {
    const fixture = makeFixture('reference')
    writeToolsManifest(fixture.ctx, ['pnpm'])
    const provider = makeFakeToolsProvider({
      available: true,
      globals: { pnpm: '10' },
      nodeVersion: 'v25.8.1'
    })
    const diff = await diffTools(fixture.ctx, provider)
    expect(planTools(fixture.ctx, provider, diff)).toEqual([])
    fixture.cleanup()
  })

  it('run() actually calls through to the provider for each action kind', async () => {
    const fixture = makeFixture('reference')
    writeToolsManifest(fixture.ctx, ['pnpm'])
    const provider = makeFakeToolsProvider({ available: false })
    const diff = await diffTools(fixture.ctx, provider)
    const plan = planTools(fixture.ctx, provider, diff)
    for (const action of plan) {
      const result = await action.run()
      expect(result.ok).toBe(true)
    }
    expect(provider.installNvmCalls).toEqual([DEFAULT_NVM_VERSION])
    expect(provider.installNodeCalls).toEqual(['v25.8.1'])
    expect(provider.installPackageCalls).toEqual(['pnpm'])
    fixture.cleanup()
  })
})
