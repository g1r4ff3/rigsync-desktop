import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, writeIgnore, type TestFixture } from '../../testFixtures'
import { captureFlatpak, diffFlatpak, planFlatpak, planFlatpakUninstall } from './flatpak'
import { readEffectivePackages, writeCommonFlatpakSection } from './io'
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
      uncaptured: [],
      overridesMissing: [],
      overridesChanged: []
    }
    const actions = planFlatpak(fixture.ctx, provider, diff, 'run-ts')
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

  // 신규 (구 repo엔 override 동기화 자체가 없었음) — P2c 결정 ④.
  describe('flatpak permission overrides', () => {
    it('captures a live override file into the store', async () => {
      const provider = makeFakeFlatpakProvider({
        overrideFiles: { 'org.gimp.GIMP': '[Context]\nfilesystems=host;\n' }
      })
      const report = await captureFlatpak(fixture.ctx, provider, { dryRun: false })
      expect(report.overridesAdded).toBe(1)

      const flatpak = readEffectivePackages(fixture.ctx).flatpak
      expect(flatpak?.overrides?.[0]?.appId).toBe('org.gimp.GIMP')
    })

    it('diff reports a missing override (manifested but no live file)', async () => {
      const provider1 = makeFakeFlatpakProvider({
        overrideFiles: { 'org.gimp.GIMP': '[Context]\nfilesystems=host;\n' }
      })
      await captureFlatpak(fixture.ctx, provider1, { dryRun: false })

      const provider2 = makeFakeFlatpakProvider({ overrideFiles: {} })
      const diff = await diffFlatpak(fixture.ctx, provider2)
      expect(diff.overridesMissing).toEqual(['org.gimp.GIMP'])
    })

    it('diff reports a changed override (live content differs from store)', async () => {
      const provider1 = makeFakeFlatpakProvider({
        overrideFiles: { 'org.gimp.GIMP': '[Context]\nfilesystems=host;\n' }
      })
      await captureFlatpak(fixture.ctx, provider1, { dryRun: false })

      const provider2 = makeFakeFlatpakProvider({
        overrideFiles: { 'org.gimp.GIMP': '[Context]\nfilesystems=!host;\n' }
      })
      const diff = await diffFlatpak(fixture.ctx, provider2)
      expect(diff.overridesChanged).toEqual(['org.gimp.GIMP'])
    })

    it('plan backs up the live override then writes the stored content through the provider', async () => {
      const provider1 = makeFakeFlatpakProvider({
        overrideFiles: { 'org.gimp.GIMP': '[Context]\nfilesystems=host;\n' }
      })
      await captureFlatpak(fixture.ctx, provider1, { dryRun: false })

      const provider2 = makeFakeFlatpakProvider({
        overrideFiles: { 'org.gimp.GIMP': '[Context]\nfilesystems=!host;\n' }
      })
      const diff = await diffFlatpak(fixture.ctx, provider2)
      const actions = planFlatpak(fixture.ctx, provider2, diff, 'run-override')
      expect(actions).toHaveLength(1)
      expect(actions[0].privileged).toBeFalsy()

      const result = await actions[0].run()
      expect(result.ok).toBe(true)
      expect(provider2.writeOverrideCalls).toHaveLength(1)
      expect(provider2.writeOverrideCalls[0].content.toString('utf-8')).toBe(
        '[Context]\nfilesystems=host;\n'
      )
    })

    it('a restore action fails cleanly when the store has nothing captured yet', async () => {
      const diff = {
        skipped: false,
        toAddRemotes: [],
        toInstall: [],
        uncaptured: [],
        overridesMissing: ['org.orphan.App'],
        overridesChanged: []
      }
      // manifest에 엔트리가 없으므로(직접 diff를 주입) plan은 액션을 못 만든다 --
      // 실제로는 diffFlatpak이 manifest 기반이라 이 케이스는 일어나지 않지만,
      // "스토어에 없으면 실패" 방어 로직 자체는 store 파일 부재 시나리오로 확인한다.
      const provider = makeFakeFlatpakProvider()
      writeIgnore(fixture, {}) // no-op, fixture 사용 확인용
      const { writeCommonLayer } = await import('../../manifest')
      writeCommonLayer(fixture.ctx, 'packages', {
        flatpak: {
          overrides: [
            { appId: 'org.orphan.App', storeFile: 'packages/flatpak/overrides/org.orphan.App' }
          ]
        }
      })
      const actions = planFlatpak(fixture.ctx, provider, diff, 'run-missing-store')
      expect(actions).toHaveLength(1)
      const result = await actions[0].run()
      expect(result.ok).toBe(false)
      expect(result.detail).toContain('capture')
    })
  })

  // 항목 삭제(uninstall) 엔진 — 안전 불변식 5(2026-07-26 개정).
  describe('planFlatpakUninstall', () => {
    it('rejects a managed (manifest-declared) app even if ignored — safety invariant 5', () => {
      writeCommonFlatpakSection(fixture.ctx, {
        app: [{ application: 'org.gimp.GIMP', origin: 'flathub', installation: 'user' }]
      })
      writeIgnore(fixture, { flatpak: { apps: ['org.gimp.GIMP'] } })
      const provider = makeFakeFlatpakProvider({
        apps: [{ application: 'org.gimp.GIMP', origin: 'flathub', installation: 'user' }]
      })

      const result = planFlatpakUninstall(fixture.ctx, provider, ['org.gimp.GIMP'])

      expect(result.actions).toEqual([])
      expect(result.excluded).toEqual([
        { capability: 'flatpak', key: 'org.gimp.GIMP', reason: expect.stringContaining('managed') }
      ])
      expect(provider.uninstallCalls).toEqual([])
    })

    it('rejects an app that is not ignored (paused) yet', () => {
      const provider = makeFakeFlatpakProvider({
        apps: [{ application: 'org.gimp.GIMP', origin: 'flathub', installation: 'user' }]
      })
      const result = planFlatpakUninstall(fixture.ctx, provider, ['org.gimp.GIMP'])
      expect(result.actions).toEqual([])
      expect(result.excluded[0].reason).toContain('일시중지')
    })

    it('rejects an app that is not installed on this machine', () => {
      writeIgnore(fixture, { flatpak: { apps: ['org.ghost.App'] } })
      const provider = makeFakeFlatpakProvider({ apps: [] })
      const result = planFlatpakUninstall(fixture.ctx, provider, ['org.ghost.App'])
      expect(result.actions).toEqual([])
      expect(result.excluded[0].reason).toContain('설치돼 있지 않음')
    })

    it('produces one unprivileged action per app id and actually invokes the provider when run', async () => {
      writeIgnore(fixture, { flatpak: { apps: ['org.gimp.GIMP', 'org.deskflow.deskflow'] } })
      const provider = makeFakeFlatpakProvider({
        apps: [
          { application: 'org.gimp.GIMP', origin: 'flathub', installation: 'user' },
          { application: 'org.deskflow.deskflow', origin: 'flathub', installation: 'user' }
        ]
      })

      const result = planFlatpakUninstall(fixture.ctx, provider, [
        'org.gimp.GIMP',
        'org.deskflow.deskflow'
      ])

      expect(result.actions).toHaveLength(2)
      expect(result.actions.every((a) => a.privileged === false)).toBe(true)
      expect(result.actions[0].commands[0]).toBe('flatpak uninstall --user -y org.gimp.GIMP')

      const runResults = await Promise.all(result.actions.map((a) => a.run()))
      expect(runResults.every((r) => r.ok)).toBe(true)
      expect(provider.uninstallCalls).toEqual(['org.gimp.GIMP', 'org.deskflow.deskflow'])
    })

    it('reports skipped-with-reason when flatpak is unavailable', () => {
      const provider = makeFakeFlatpakProvider({ available: false })
      const result = planFlatpakUninstall(fixture.ctx, provider, ['org.gimp.GIMP'])
      expect(result.actions).toEqual([])
      expect(result.excluded[0].reason).toContain('flatpak')
    })
  })
})
