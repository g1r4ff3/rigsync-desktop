import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, writeIgnore, type TestFixture } from '../../testFixtures'
import { captureFlatpak, diffFlatpak, planFlatpak } from './flatpak'
import { readEffectivePackages } from './io'
import { makeFakeFlatpakProvider } from './testHelpers'

// 케이스 출처: 구 repo rigsync.py capture_flatpak/diff_flatpak/plan_flatpak +
// tests/test_ignore.py TestIgnoreFlatpak (행동만 옮김). 명령이 `flatpak install
// -y ...`(구 repo, 시스템 전역)가 아니라 `--user`인 것은 P2a 결정 ②에 따른
// 의도적 차이 — unprivileged로 실제 실행된다.

describe('captureFlatpak / diffFlatpak / planFlatpak', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('reports skipped when flatpak is unavailable', async () => {
    const provider = makeFakeFlatpakProvider({ available: false })
    const report = await captureFlatpak(fixture.ctx, provider, { dryRun: false })
    expect(report.skipped).toBe(true)
  })

  it('captures remotes and apps', async () => {
    const provider = makeFakeFlatpakProvider({
      remotes: [{ name: 'flathub', url: 'https://dl.flathub.org/repo/' }],
      apps: [{ application: 'org.deskflow.deskflow', origin: 'flathub', installation: 'system' }]
    })
    const report = await captureFlatpak(fixture.ctx, provider, { dryRun: false })
    expect(report.addedRemotes).toBe(1)
    expect(report.addedApps).toBe(1)

    const flatpak = readEffectivePackages(fixture.ctx).flatpak
    expect(flatpak?.remote?.[0]?.name).toBe('flathub')
    expect(flatpak?.app?.[0]?.application).toBe('org.deskflow.deskflow')
  })

  it('diff reports a manifested app not currently installed', async () => {
    const provider1 = makeFakeFlatpakProvider({
      remotes: [{ name: 'flathub', url: 'https://dl.flathub.org/repo/' }],
      apps: [{ application: 'org.deskflow.deskflow', origin: 'flathub', installation: 'system' }]
    })
    await captureFlatpak(fixture.ctx, provider1, { dryRun: false })

    const provider2 = makeFakeFlatpakProvider({ remotes: [], apps: [] })
    const diff = await diffFlatpak(fixture.ctx, provider2)
    expect(diff.toInstall.map((a) => a.application)).toEqual(['org.deskflow.deskflow'])
  })

  it('plan produces unprivileged actions that actually invoke the provider when run', async () => {
    const provider = makeFakeFlatpakProvider()
    const diff = {
      skipped: false,
      toAddRemotes: [{ name: 'flathub', url: 'https://dl.flathub.org/repo/' }],
      toInstall: [
        { application: 'org.deskflow.deskflow', origin: 'flathub', installation: 'system' }
      ],
      uncaptured: []
    }
    const actions = planFlatpak(provider, diff)
    expect(actions).toHaveLength(2)
    expect(actions.every((a) => a.privileged === false)).toBe(true)
    expect(actions[0].commands[0]).toBe(
      'flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/'
    )
    expect(actions[1].commands[0]).toBe('flatpak install --user -y flathub org.deskflow.deskflow')

    const results = await Promise.all(actions.map((a) => a.run()))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(provider.addRemoteCalls).toEqual([
      { name: 'flathub', url: 'https://dl.flathub.org/repo/' }
    ])
    expect(provider.installCalls).toEqual([
      { origin: 'flathub', application: 'org.deskflow.deskflow' }
    ])
  })

  // 케이스 출처: tests/test_ignore.py TestIgnoreFlatpak
  it('capture and diff skip an ignored app (test_capture_and_diff_skip_ignored_app)', async () => {
    writeIgnore(fixture, { flatpak: { apps: ['org.deskflow.deskflow'] } })
    const provider = makeFakeFlatpakProvider({
      remotes: [{ name: 'flathub', url: 'https://dl.flathub.org/repo/' }],
      apps: [{ application: 'org.deskflow.deskflow', origin: 'flathub', installation: 'system' }]
    })
    await captureFlatpak(fixture.ctx, provider, { dryRun: false })

    const flatpak = readEffectivePackages(fixture.ctx).flatpak
    const apps = (flatpak?.app ?? []).map((a) => a.application)
    expect(apps).not.toContain('org.deskflow.deskflow')

    const diff = await diffFlatpak(fixture.ctx, provider)
    expect(diff.toInstall).toEqual([])
  })
})
