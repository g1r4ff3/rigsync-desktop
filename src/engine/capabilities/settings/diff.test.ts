import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { captureSettings } from './capture'
import { diffSettings } from './diff'
import { SETTINGS_LAYER } from './constants'
import { makeFakeDconfProvider } from './testHelpers'

describe('diffSettings', () => {
  it('reports skipped when dconf is unavailable', async () => {
    const fixture = makeFixture('reference')
    const d = await diffSettings(fixture.ctx, makeFakeDconfProvider({ available: false }))
    expect(d.skipped).toBe(true)
    fixture.cleanup()
  })

  it('reports no drift when live dump matches the stored file', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeDconfProvider({ dumps: { '/a/b': 'x=1\n' } })
    await captureSettings({ ...fixture.ctx, settings: { dconfPaths: ['/a/b'] } }, provider, {
      dryRun: false
    })
    const d = await diffSettings(fixture.ctx, provider)
    expect(d.contentChanged).toEqual([])
    fixture.cleanup()
  })

  it('reports a path as changed when live dump differs from stored', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SETTINGS_LAYER, {
      path: [{ path: '/a/b', file: 'settings/dconf/a-b.ini' }]
    })
    const provider = makeFakeDconfProvider({ dumps: { '/a/b': 'x=2\n' } })
    const d = await diffSettings(fixture.ctx, provider)
    expect(d.contentChanged).toEqual(['/a/b'])
    fixture.cleanup()
  })
})
