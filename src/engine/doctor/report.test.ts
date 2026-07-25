import { describe, expect, it } from 'vitest'
import { makeFixture } from '../testFixtures'
import { writeCommonLayer } from '../manifest'
import { writeIgnore } from '../testFixtures'
import { makeFakeGearLeverProvider } from '../capabilities/appimage/testHelpers'
import { buildDoctorReport, CHECKS_LAYER } from './report'
import { makeFakeDoctorSystemProvider, makeFakeNvidiaProvider } from './testHelpers'

// checksVisible 케이스 출처: 구 repo gui.py `doctor_visible`(코드 복사 아님).

describe('buildDoctorReport', () => {
  it('checksVisible is false and checks is empty when there are no checks at all', () => {
    const fixture = makeFixture('reference')
    const report = buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeNvidiaProvider(),
      { configConfigured: true }
    )
    expect(report.checksVisible).toBe(false)
    expect(report.checks).toEqual([])
    expect(report.exitCode).toBe(0)
    fixture.cleanup()
  })

  it('ignored check names are absent from the table entirely (not shown as skipped)', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, CHECKS_LAYER, {
      check: [
        { name: 'zoom', type: 'file', target: '/opt/zoom' },
        { name: 'tailscale', type: 'cmd', target: 'tailscale status' }
      ]
    })
    writeIgnore(fixture, { checks: { names: ['zoom'] } })
    const report = buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeNvidiaProvider(),
      { configConfigured: true }
    )
    expect(report.checks.map((c) => c.name)).toEqual(['tailscale'])
    expect(report.checksVisible).toBe(true)
    fixture.cleanup()
  })

  it('exitCode is 1 when any active check fails', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, CHECKS_LAYER, {
      check: [{ name: 'zoom', type: 'file', target: '/opt/zoom' }]
    })
    const report = buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: false }),
      { isPackageInstalled: () => false },
      makeFakeNvidiaProvider(),
      { configConfigured: true }
    )
    expect(report.exitCode).toBe(1)
    fixture.cleanup()
  })

  it('includes basic diagnostics and the T3 appimage preflight in the same report', () => {
    const fixture = makeFixture('follower')
    const report = buildDoctorReport(
      fixture.ctx,
      makeFakeDoctorSystemProvider(),
      makeFakeGearLeverProvider({ available: true, version: '4.6.2' }),
      { isPackageInstalled: (pkg: string) => pkg === 'libfuse2t64' },
      makeFakeNvidiaProvider({
        nvrmVersion: '580.173.02',
        packages: [{ name: 'nvidia-driver-580', version: '580.173.02' }]
      }),
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
})
