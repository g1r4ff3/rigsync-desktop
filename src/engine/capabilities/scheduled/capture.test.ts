import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { captureScheduled, FollowerScheduledCaptureBlockedError } from './capture'
import { SCHEDULED_STORE_REL_PATH } from './constants'
import { makeFakeCronProvider } from './testHelpers'

// 케이스 출처: 구 repo rigsync.py capture_cron 행동(코드 복사 아님). 파일 단위
// 캡처(라인 단위 아님)라는 계약을 유지한다 — 정책이 명시한 계승 함정.

describe('captureScheduled', () => {
  it('rejects capture on a follower machine', async () => {
    const fixture = makeFixture('follower')
    await expect(
      captureScheduled(fixture.ctx, makeFakeCronProvider({ crontab: '0 * * * * true\n' }), {
        dryRun: false
      })
    ).rejects.toThrow(FollowerScheduledCaptureBlockedError)
    fixture.cleanup()
  })

  it('reports skipped when crontab is unavailable', async () => {
    const fixture = makeFixture('reference')
    const report = await captureScheduled(fixture.ctx, makeFakeCronProvider({ available: false }), {
      dryRun: false
    })
    expect(report.skipped).toBe(true)
    fixture.cleanup()
  })

  it('reports not captured when the user has no crontab at all', async () => {
    const fixture = makeFixture('reference')
    const report = await captureScheduled(fixture.ctx, makeFakeCronProvider({ crontab: null }), {
      dryRun: false
    })
    expect(report.captured).toBe(false)
    expect(report.note).toContain('no crontab for user')
    fixture.cleanup()
  })

  it('captures the whole crontab as one file and counts non-blank lines', async () => {
    const fixture = makeFixture('reference')
    const tab = '# comment\n0 * * * * true\n\n30 2 * * * /usr/bin/backup\n'
    const report = await captureScheduled(fixture.ctx, makeFakeCronProvider({ crontab: tab }), {
      dryRun: false
    })
    expect(report.captured).toBe(true)
    expect(report.lines).toBe(3)
    const stored = fs.readFileSync(
      path.join(fixture.ctx.manifestDir, SCHEDULED_STORE_REL_PATH),
      'utf-8'
    )
    expect(stored).toBe(tab)
    fixture.cleanup()
  })

  it('dry-run computes counts but writes nothing', async () => {
    const fixture = makeFixture('reference')
    const report = await captureScheduled(
      fixture.ctx,
      makeFakeCronProvider({ crontab: '0 * * * * true\n' }),
      { dryRun: true }
    )
    expect(report.captured).toBe(true)
    expect(fs.existsSync(path.join(fixture.ctx.manifestDir, SCHEDULED_STORE_REL_PATH))).toBe(false)
    fixture.cleanup()
  })
})
