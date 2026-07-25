import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { captureScheduled } from './capture'
import { diffScheduled } from './diff'
import { makeFakeCronProvider } from './testHelpers'

describe('diffScheduled', () => {
  it('reports no drift, no manifest when there is no stored file and no live crontab', async () => {
    const fixture = makeFixture('reference')
    const d = await diffScheduled(fixture.ctx, makeFakeCronProvider({ crontab: null }))
    expect(d.contentChanged).toBe(false)
    fixture.cleanup()
  })

  it('is in sync right after capture', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeCronProvider({ crontab: '0 * * * * true\n' })
    await captureScheduled(fixture.ctx, provider, { dryRun: false })
    const d = await diffScheduled(fixture.ctx, provider)
    expect(d.contentChanged).toBe(false)
    expect(d.lineDiff).toEqual({ added: [], removed: [] })
    fixture.cleanup()
  })

  it('flags content_changed and reports a line-level diff (added/removed) as an allowed improvement', async () => {
    const fixture = makeFixture('reference')
    const stored = '0 * * * * true\n30 2 * * * /usr/bin/backup\n'
    const provider = makeFakeCronProvider({ crontab: stored })
    await captureScheduled(fixture.ctx, provider, { dryRun: false })

    const live = '0 * * * * true\n0 5 * * * /usr/bin/new-job\n'
    const provider2 = makeFakeCronProvider({ crontab: live })
    const d = await diffScheduled(fixture.ctx, provider2)

    expect(d.contentChanged).toBe(true)
    expect(d.lineDiff.added).toEqual(['30 2 * * * /usr/bin/backup'])
    expect(d.lineDiff.removed).toEqual(['0 5 * * * /usr/bin/new-job'])
    fixture.cleanup()
  })
})
