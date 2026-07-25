import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { captureScheduled } from './capture'
import { diffScheduled } from './diff'
import { planScheduled } from './plan'
import { makeFakeCronProvider } from './testHelpers'

describe('planScheduled', () => {
  it('produces no actions when in sync (test_no_actions_when_in_sync equivalent)', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeCronProvider({ crontab: '0 * * * * true\n' })
    await captureScheduled(fixture.ctx, provider, { dryRun: false })
    const diff = await diffScheduled(fixture.ctx, provider)
    expect(planScheduled(fixture.ctx, provider, diff, 'run-1')).toEqual([])
    fixture.cleanup()
  })

  it('a restore action is never sudo, and run() backs up the live crontab then restores from the manifest', async () => {
    const fixture = makeFixture('reference')
    const stored = '0 * * * * true\n'
    const captureProvider = makeFakeCronProvider({ crontab: stored })
    await captureScheduled(fixture.ctx, captureProvider, { dryRun: false })

    const liveProvider = makeFakeCronProvider({ crontab: '5 5 * * * old\n' })
    const diff = await diffScheduled(fixture.ctx, liveProvider)
    expect(diff.contentChanged).toBe(true)

    const actions = planScheduled(fixture.ctx, liveProvider, diff, 'run-2')
    expect(actions).toHaveLength(1)
    for (const cmd of actions[0].commands) expect(cmd.trim().startsWith('sudo')).toBe(false)

    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(liveProvider.writtenContents).toEqual([stored])
    const backup = fs.readFileSync(
      path.join(fixture.ctx.backupRoot, 'run-2', 'scheduled', 'crontab.txt'),
      'utf-8'
    )
    expect(backup).toBe('5 5 * * * old\n')
    fixture.cleanup()
  })
})
