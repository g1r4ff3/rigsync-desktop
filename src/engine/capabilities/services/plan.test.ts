import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { planServices } from './plan'
import { SERVICES_LAYER } from './constants'
import { makeFakeSystemdUserProvider } from './testHelpers'

function writeStore(manifestDir: string, rel: string, content: string): void {
  const abs = path.join(manifestDir, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

describe('planServices', () => {
  it('produces no actions when nothing is missing/changed/mismatched', () => {
    const fixture = makeFixture('reference')
    const actions = planServices(
      fixture.ctx,
      makeFakeSystemdUserProvider(),
      {
        missing: [],
        contentChanged: [],
        enabledMismatch: []
      },
      'run-1'
    )
    expect(actions).toEqual([])
    fixture.cleanup()
  })

  it('a restore action is never privileged, and run() actually restores + reloads + enables via the provider', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, {
      unit: [{ name: 'foo.service', file: 'services/systemd-user/foo.service', enabled: true }]
    })
    writeStore(
      fixture.ctx.manifestDir,
      'services/systemd-user/foo.service',
      '[Service]\nExecStart=/bin/true\n'
    )

    const provider = makeFakeSystemdUserProvider()
    const actions = planServices(
      fixture.ctx,
      provider,
      { missing: ['foo.service'], contentChanged: [], enabledMismatch: [] },
      'run-1'
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].privileged).toBeFalsy()
    for (const cmd of actions[0].commands) expect(cmd.trim().startsWith('sudo')).toBe(false)

    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(provider.written).toEqual([
      { name: 'foo.service', content: '[Service]\nExecStart=/bin/true\n' }
    ])
    expect(provider.reloadCallCount.count).toBe(1)
    expect(provider.enabledCalls).toEqual(['foo.service'])
    fixture.cleanup()
  })

  it('backs up the live unit file before overwriting it', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, {
      unit: [{ name: 'foo.service', file: 'services/systemd-user/foo.service', enabled: false }]
    })
    writeStore(fixture.ctx.manifestDir, 'services/systemd-user/foo.service', '[Service]\nnew\n')

    const provider = makeFakeSystemdUserProvider({
      units: [{ name: 'foo.service', content: '[Service]\nold\n' }]
    })
    const actions = planServices(
      fixture.ctx,
      provider,
      { missing: [], contentChanged: ['foo.service'], enabledMismatch: [] },
      'run-2'
    )
    await actions[0].run()
    const backup = fs.readFileSync(
      path.join(fixture.ctx.backupRoot, 'run-2', 'services', 'foo.service'),
      'utf-8'
    )
    expect(backup).toBe('[Service]\nold\n')
    fixture.cleanup()
  })
})
