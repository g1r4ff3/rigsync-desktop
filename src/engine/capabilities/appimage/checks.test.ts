import { describe, expect, it } from 'vitest'
import { checkAppimagePreflight, versionAtLeast } from './checks'
import { makeFakeAppimageSystemCheckProvider, makeFakeGearLeverProvider } from './testHelpers'

describe('versionAtLeast', () => {
  it('accepts equal versions', () => {
    expect(versionAtLeast('4.6.2', '4.6.2')).toBe(true)
  })

  it('accepts a newer version', () => {
    expect(versionAtLeast('4.7.0', '4.6.2')).toBe(true)
    expect(versionAtLeast('5.0.0', '4.6.2')).toBe(true)
  })

  it('rejects an older version', () => {
    expect(versionAtLeast('4.6.1', '4.6.2')).toBe(false)
    expect(versionAtLeast('4.5.9', '4.6.2')).toBe(false)
  })
})

describe('checkAppimagePreflight', () => {
  it("all green: Gear Lever >= 4.6.2, libfuse2t64 present, no AppImageLauncher (this dev machine's real state)", () => {
    // §7 실측: 이 머신은 Gear Lever 4.6.2, libfuse2t64 설치됨, AppImageLauncher 없음.
    const provider = makeFakeGearLeverProvider({ available: true, version: '4.6.2' })
    const systemCheck = makeFakeAppimageSystemCheckProvider(['libfuse2t64'])
    const result = checkAppimagePreflight(provider, systemCheck)

    expect(result.gearLeverInstalled).toBe(true)
    expect(result.gearLeverVersionOk).toBe(true)
    expect(result.libfuse2t64Installed).toBe(true)
    expect(result.appImageLauncherPresent).toBe(false)
    expect(result.warnings).toEqual([])
  })

  it('warns when Gear Lever is missing', () => {
    const provider = makeFakeGearLeverProvider({ available: false })
    const systemCheck = makeFakeAppimageSystemCheckProvider(['libfuse2t64'])
    const result = checkAppimagePreflight(provider, systemCheck)
    expect(result.gearLeverInstalled).toBe(false)
    expect(result.warnings.some((w) => w.includes('Gear Lever'))).toBe(true)
  })

  it('warns when Gear Lever version is below the minimum', () => {
    const provider = makeFakeGearLeverProvider({ available: true, version: '4.5.0' })
    const systemCheck = makeFakeAppimageSystemCheckProvider(['libfuse2t64'])
    const result = checkAppimagePreflight(provider, systemCheck)
    expect(result.gearLeverVersionOk).toBe(false)
    expect(result.warnings.some((w) => w.includes('4.6.2'))).toBe(true)
  })

  it('warns when libfuse2t64 is missing', () => {
    const provider = makeFakeGearLeverProvider({ available: true, version: '4.6.2' })
    const systemCheck = makeFakeAppimageSystemCheckProvider([])
    const result = checkAppimagePreflight(provider, systemCheck)
    expect(result.warnings.some((w) => w.includes('libfuse2t64'))).toBe(true)
  })

  it('warns when AppImageLauncher is present (conflict risk)', () => {
    const provider = makeFakeGearLeverProvider({ available: true, version: '4.6.2' })
    const systemCheck = makeFakeAppimageSystemCheckProvider(['libfuse2t64', 'appimagelauncher'])
    const result = checkAppimagePreflight(provider, systemCheck)
    expect(result.appImageLauncherPresent).toBe(true)
    expect(result.warnings.some((w) => w.includes('AppImageLauncher'))).toBe(true)
  })
})
