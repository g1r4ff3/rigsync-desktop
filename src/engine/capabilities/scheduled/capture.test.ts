import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { captureScheduled, FollowerScheduledCaptureBlockedError } from './capture'
import { SCHEDULED_STORE_REL_PATH } from './constants'
import { scheduledHostStorePath } from './store'
import { makeFakeCronProvider } from './testHelpers'

// 픽스처 주의(★): public repo -- 실제 토큰 형식을 흉내내지 않도록 `.repeat()`로
// 조립한 반복 단어 더미만 쓴다.
const FAKE_GITHUB_PAT = 'ghp_' + 'FAKE'.repeat(9)

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

  it('blocks the whole crontab capture when a high-confidence secret is present', async () => {
    const fixture = makeFixture('reference')
    const tab = `0 * * * * curl -H "Authorization: token ${FAKE_GITHUB_PAT}" https://example.com\n`
    const report = await captureScheduled(fixture.ctx, makeFakeCronProvider({ crontab: tab }), {
      dryRun: false
    })
    expect(report.captured).toBe(false)
    expect(report.secretScanBlocked.some((f) => f.kind === 'github-pat')).toBe(true)
    expect(JSON.stringify(report)).not.toContain(FAKE_GITHUB_PAT)
    expect(fs.existsSync(path.join(fixture.ctx.manifestDir, SCHEDULED_STORE_REL_PATH))).toBe(false)
    fixture.cleanup()
  })

  it('does not block an ordinary crontab with no secret-looking content', async () => {
    const fixture = makeFixture('reference')
    const tab = '0 * * * * /usr/bin/backup\n'
    const report = await captureScheduled(fixture.ctx, makeFakeCronProvider({ crontab: tab }), {
      dryRun: false
    })
    expect(report.captured).toBe(true)
    expect(report.secretScanBlocked).toHaveLength(0)
    fixture.cleanup()
  })
})

// refactor-spec-v0.2 P2 (F2 host 라우팅): host 스토어가 존재하면 capture는
// 그 파일만 갱신하고 공통 스토어를 건드리지 않는다 — 머신 고유 crontab이
// 다른 머신으로 새지 않는 성질(F1 재발 방지의 scheduled쪽 절반).
describe('captureScheduled — host store routing', () => {
  it('writes to the host store when it exists, leaving the common store untouched', async () => {
    const fixture = makeFixture('reference')
    const hostPath = scheduledHostStorePath(fixture.ctx)
    fs.mkdirSync(path.dirname(hostPath), { recursive: true })
    fs.writeFileSync(hostPath, '# old host content\n')
    const commonPath = path.join(fixture.manifestDir, SCHEDULED_STORE_REL_PATH)
    fs.mkdirSync(path.dirname(commonPath), { recursive: true })
    fs.writeFileSync(commonPath, '# common untouched\n')

    const provider = makeFakeCronProvider({ crontab: '0 * * * * /usr/bin/true\n' })
    const report = await captureScheduled(fixture.ctx, provider, { dryRun: false })

    expect(report.captured).toBe(true)
    expect(fs.readFileSync(hostPath, 'utf-8')).toBe('0 * * * * /usr/bin/true\n')
    expect(fs.readFileSync(commonPath, 'utf-8')).toBe('# common untouched\n')
    fixture.cleanup()
  })

  it('still writes to the common store when no host store exists', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeCronProvider({ crontab: '1 * * * * /usr/bin/true\n' })
    await captureScheduled(fixture.ctx, provider, { dryRun: false })
    const commonPath = path.join(fixture.manifestDir, SCHEDULED_STORE_REL_PATH)
    expect(fs.readFileSync(commonPath, 'utf-8')).toBe('1 * * * * /usr/bin/true\n')
    expect(fs.existsSync(scheduledHostStorePath(fixture.ctx))).toBe(false)
    fixture.cleanup()
  })
})
