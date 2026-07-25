import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { planSettings } from './plan'
import { SETTINGS_LAYER } from './constants'
import { makeFakeDconfProvider } from './testHelpers'

describe('planSettings', () => {
  it('produces no actions when diff has no drift', () => {
    const fixture = makeFixture('reference')
    const actions = planSettings(fixture.ctx, makeFakeDconfProvider(), {
      skipped: false,
      contentChanged: []
    })
    expect(actions).toEqual([])
    fixture.cleanup()
  })

  it('a dconf load action is never privileged, and run() actually loads via the provider', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SETTINGS_LAYER, {
      path: [{ path: '/a/b', file: 'settings/dconf/a-b.ini' }]
    })
    const storedAbs = path.join(fixture.ctx.manifestDir, 'settings/dconf/a-b.ini')
    fs.mkdirSync(path.dirname(storedAbs), { recursive: true })
    fs.writeFileSync(storedAbs, 'x=2\n')

    const provider = makeFakeDconfProvider({ dumps: { '/a/b': 'x=1\n' } })
    const actions = planSettings(fixture.ctx, provider, {
      skipped: false,
      contentChanged: ['/a/b']
    })
    expect(actions).toHaveLength(1)
    expect(actions[0].privileged).toBeFalsy()
    for (const cmd of actions[0].commands) expect(cmd.trim().startsWith('sudo')).toBe(false)

    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(provider.loaded).toEqual([{ path: '/a/b', data: 'x=2\n' }])
    fixture.cleanup()
  })
})
