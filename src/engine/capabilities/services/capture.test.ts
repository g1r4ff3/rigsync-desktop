import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { readCommonLayer } from '../../manifest'
import { captureServices, FollowerServicesCaptureBlockedError } from './capture'
import { SERVICES_LAYER } from './constants'
import { makeFakeSystemdUserProvider } from './testHelpers'
import type { ServicesManifest } from './types'

// 픽스처 주의(★): public repo -- 실제 토큰 형식을 흉내내지 않도록 `.repeat()`로
// 조립한 반복 단어 더미만 쓴다.
const FAKE_GITHUB_PAT = 'ghp_' + 'FAKE'.repeat(9)

// 케이스 출처: 구 repo rigsync.py capture_services 행동(코드 복사 아님).

describe('captureServices', () => {
  it('rejects capture on a follower machine', async () => {
    const fixture = makeFixture('follower')
    const provider = makeFakeSystemdUserProvider({
      units: [{ name: 'foo.service', content: '[Service]\n' }]
    })
    await expect(captureServices(fixture.ctx, provider, { dryRun: false })).rejects.toThrow(
      FollowerServicesCaptureBlockedError
    )
    fixture.cleanup()
  })

  it('captures live units with their enabled state', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeSystemdUserProvider({
      units: [{ name: 'foo.service', content: '[Service]\nExecStart=/bin/true\n' }],
      enabled: { 'foo.service': true }
    })
    const report = await captureServices(fixture.ctx, provider, { dryRun: false })
    expect(report.captured).toBe(1)

    const manifest = readCommonLayer(fixture.ctx, SERVICES_LAYER) as ServicesManifest
    expect(manifest.unit).toHaveLength(1)
    expect(manifest.unit?.[0]).toEqual({
      name: 'foo.service',
      file: 'services/systemd-user/foo.service',
      enabled: true
    })
    const stored = fs.readFileSync(
      path.join(fixture.ctx.manifestDir, manifest.unit![0].file),
      'utf-8'
    )
    expect(stored).toBe('[Service]\nExecStart=/bin/true\n')
    fixture.cleanup()
  })

  it('dry-run computes counts but writes nothing to the manifest or store', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeSystemdUserProvider({
      units: [{ name: 'foo.service', content: '[Service]\n' }]
    })
    const report = await captureServices(fixture.ctx, provider, { dryRun: true })
    expect(report.captured).toBe(1)
    const manifest = readCommonLayer(fixture.ctx, SERVICES_LAYER) as ServicesManifest
    expect(manifest.unit ?? []).toEqual([])
    fixture.cleanup()
  })

  it('blocks only the unit containing a secret, capturing the rest normally', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeSystemdUserProvider({
      units: [
        { name: 'clean.service', content: '[Service]\nExecStart=/bin/true\n' },
        {
          name: 'leaky.service',
          content: `[Service]\nEnvironment=GITHUB_TOKEN=${FAKE_GITHUB_PAT}\n`
        }
      ]
    })
    const report = await captureServices(fixture.ctx, provider, { dryRun: false })

    expect(report.captured).toBe(1)
    expect(report.skippedSecretScan).toBe(1)
    expect(report.secretScanBlocked).toHaveLength(1)
    expect(report.secretScanBlocked[0].name).toBe('leaky.service')
    expect(JSON.stringify(report)).not.toContain(FAKE_GITHUB_PAT)

    const manifest = readCommonLayer(fixture.ctx, SERVICES_LAYER) as ServicesManifest
    const names = (manifest.unit ?? []).map((u) => u.name)
    expect(names).toContain('clean.service')
    expect(names).not.toContain('leaky.service')
    expect(
      fs.existsSync(path.join(fixture.ctx.manifestDir, 'services', 'systemd-user', 'leaky.service'))
    ).toBe(false)
    fixture.cleanup()
  })
})
