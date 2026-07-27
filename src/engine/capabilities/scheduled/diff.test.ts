import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { captureScheduled } from './capture'
import { diffScheduled } from './diff'
import { scheduledHostStorePath } from './store'
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

// refactor-spec-v0.2 P2: host 스토어가 있으면 diff도 그 파일과 비교한다 —
// capture/diff/plan이 같은 해석을 써야 수렴한다.
describe('diffScheduled — host store routing', () => {
  it('compares against the host store and converges after a host-store capture', async () => {
    const fixture = makeFixture('reference')
    const hostPath = scheduledHostStorePath(fixture.ctx)
    fs.mkdirSync(path.dirname(hostPath), { recursive: true })
    fs.writeFileSync(hostPath, '# seed\n')
    // 공통 스토어에 다른 내용이 있어도 host 스토어가 우선이다.
    const commonPath = path.join(fixture.manifestDir, 'scheduled', 'crontab.txt')
    fs.mkdirSync(path.dirname(commonPath), { recursive: true })
    fs.writeFileSync(commonPath, '# something else entirely\n')

    const provider = makeFakeCronProvider({ crontab: '2 * * * * /usr/bin/true\n' })
    await captureScheduled(fixture.ctx, provider, { dryRun: false })
    const d = await diffScheduled(fixture.ctx, provider)

    expect(d.contentChanged).toBe(false)
    expect(d.lineDiff).toEqual({ added: [], removed: [] })
    fixture.cleanup()
  })
})
