import { describe, expect, it } from 'vitest'
import { makeFixture } from '../testFixtures'
import { writeCommonLayer } from '../manifest'
import { writeIgnore } from '../testFixtures'
import { makeFakeGearLeverProvider } from '../capabilities/appimage/testHelpers'
import { makeFakeFontsSystemProvider } from '../capabilities/fonts/testHelpers'
import { makeFakeAptProvider } from '../capabilities/packages/testHelpers'
import { makeFakeGitTransportProvider } from '../transport/testHelpers'
import { buildDoctorReport, CHECKS_LAYER } from './report'
import { makeFakeDoctorSystemProvider, makeFakeNvidiaProvider } from './testHelpers'

const gitTransportProvider = makeFakeGitTransportProvider()
// 이 파일의 기존 케이스들은 aptShadow 검사와 무관하다 -- apt-mark 자체를
// 미가용으로 둬(available:false) checkAptShadowing이 즉시 skip하게 한다.
// aptShadow 자체 행동은 aptShadowCheck.test.ts가 전담한다.
const aptProvider = makeFakeAptProvider({ available: false })

// checksVisible 케이스 출처: 구 repo gui.py `doctor_visible`(코드 복사 아님).

describe('buildDoctorReport', () => {
  it('checksVisible is false and checks is empty when there are no checks at all', async () => {
    const fixture = makeFixture('reference')
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true }
    )
    expect(report.checksVisible).toBe(false)
    expect(report.checks).toEqual([])
    expect(report.exitCode).toBe(0)
    fixture.cleanup()
  })

  it('ignored check names are absent from the table entirely (not shown as skipped)', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, CHECKS_LAYER, {
      check: [
        { name: 'zoom', type: 'file', target: '/opt/zoom' },
        { name: 'tailscale', type: 'cmd', target: 'tailscale status' }
      ]
    })
    writeIgnore(fixture, { checks: { names: ['zoom'] } })
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true }
    )
    expect(report.checks.map((c) => c.name)).toEqual(['tailscale'])
    expect(report.checksVisible).toBe(true)
    fixture.cleanup()
  })

  it('exitCode is 1 when any active check fails', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, CHECKS_LAYER, {
      check: [{ name: 'zoom', type: 'file', target: '/opt/zoom' }]
    })
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true }
    )
    expect(report.exitCode).toBe(1)
    fixture.cleanup()
  })

  it('includes basic diagnostics and the T3 appimage preflight in the same report', async () => {
    const fixture = makeFixture('follower')
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: true, version: '4.6.2' }),
      { isPackageInstalled: (pkg: string) => pkg === 'libfuse2t64' },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider({
        nvrmVersion: '580.173.02',
        packages: [{ name: 'nvidia-driver-580', version: '580.173.02' }]
      }),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true }
    )
    expect(report.basic).toEqual({
      machineId: fixture.ctx.machineId,
      role: 'follower',
      manifestDirExists: false,
      configConfigured: true
    })
    expect(report.appimage.gearLeverInstalled).toBe(true)
    expect(report.appimage.warnings).toEqual([])
    expect(report.nvidia).toEqual({
      applicable: true,
      nvrmVersion: '580.173.02',
      userspaceVersion: '580.173.02',
      matched: true
    })
    fixture.cleanup()
  })

  it('includes the fonts preflight in the same report', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, 'fonts', {
      font: [
        {
          name: 'MesloLGS NF',
          source: { kind: 'static', urls: [] },
          files: ['MesloLGS NF Regular.ttf']
        }
      ]
    })
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true }
    )
    expect(report.fonts.missingInstalled).toEqual(['MesloLGS NF'])
    expect(report.fonts.fcCacheAvailable).toBe(true)
    fixture.cleanup()
  })

  it('includes the binaries preflight (F5/P5) in the same report', async () => {
    const fixture = makeFixture('reference')
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true }
    )
    expect(report.binaries).toEqual({ unresolvedInstalled: [], warnings: [] })
    fixture.cleanup()
  })

  it('surfaces the empty-follower warning for a follower with an empty, remote-less manifest', async () => {
    const fixture = makeFixture('follower')
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      makeFakeGitTransportProvider({ isGitRepo: false, hasRemote: false }),
      aptProvider,
      { configConfigured: true }
    )
    expect(report.emptyFollower.applicable).toBe(true)
    expect(report.emptyFollower.warning).toBeDefined()
    fixture.cleanup()
  })

  it('does not warn for a reference machine with an empty manifest (normal pre-first-capture state)', async () => {
    const fixture = makeFixture('reference')
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      makeFakeGitTransportProvider({ isGitRepo: false, hasRemote: false }),
      aptProvider,
      { configConfigured: true }
    )
    expect(report.emptyFollower.applicable).toBe(false)
    expect(report.emptyFollower.warning).toBeUndefined()
    fixture.cleanup()
  })

  it('selfUpdate is not applicable when appImagePath is null (dev/deb run)', async () => {
    const fixture = makeFixture('reference')
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: true }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true, appImagePath: null }
    )
    expect(report.selfUpdate).toEqual({ applicable: false, status: 'not-appimage' })
    fixture.cleanup()
  })

  it('selfUpdate warns with a manual command when running as an AppImage without an update source', async () => {
    const fixture = makeFixture('reference')
    const appImagePath = '/home/user/Applications/rigsync-desktop.AppImage'
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: true, configsByPath: {} }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true, appImagePath }
    )
    expect(report.selfUpdate.applicable).toBe(true)
    expect(report.selfUpdate.status).toBe('not-integrated')
    expect(report.selfUpdate.warning).toBeDefined()
    fixture.cleanup()
  })

  it('includes the manifestDirty check (P3) in the same report', async () => {
    const fixture = makeFixture('follower')
    const dirtyProvider = makeFakeGitTransportProvider({
      isGitRepo: true,
      changedFiles: [{ status: ' M', path: 'dotfiles/.zshrc' }]
    })
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      dirtyProvider,
      aptProvider,
      { configConfigured: true }
    )
    expect(report.manifestDirty.dirty).toBe(true)
    expect(report.manifestDirty.warning).toBeDefined()
    fixture.cleanup()
  })

  it('selfUpdate passes when the update source is already configured for this AppImage', async () => {
    const fixture = makeFixture('reference')
    const appImagePath = '/home/user/Applications/rigsync-desktop.AppImage'
    const report = await buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({
        available: true,
        configsByPath: {
          [appImagePath]: {
            updateManager: {
              repo: 'g1r4ff3/rigsync-desktop',
              repoFilename: 'rigsync-desktop-*.AppImage',
              manager: 'GithubUpdater',
              allowPrereleases: false
            }
          }
        }
      }),
      { isPackageInstalled: () => false },
      makeFakeFontsSystemProvider(),
      makeFakeNvidiaProvider(),
      gitTransportProvider,
      aptProvider,
      { configConfigured: true, appImagePath }
    )
    expect(report.selfUpdate).toEqual({ applicable: true, status: 'configured' })
    fixture.cleanup()
  })
})
