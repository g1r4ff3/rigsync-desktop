import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeFakeAptProvider,
  makeFakeFlatpakProvider,
  makeFakeSnapProvider
} from './capabilities/packages/testHelpers'
import { makeFakeGearLeverProvider } from './capabilities/appimage/testHelpers'
import { detectDuplicateApps, detectDuplicates, type DuplicateSourceItem } from './duplicates'
import { makeFixture, type TestFixture } from './testFixtures'
import { setIgnored } from './ignore'

// 신규 테스트 — 정책 §1.3 INV-1(구 repo엔 이 개념이 없었음, GTK GUI는
// candidate_groups로 "uncaptured"만 다뤘지 계층 간 중복 검출은 없었다).

describe('detectDuplicateApps (pure heuristic)', () => {
  it('groups the same app across different layers by lowercase name inclusion', () => {
    const items: DuplicateSourceItem[] = [
      { capability: 'apt', label: 'gimp' },
      { capability: 'flatpak', label: 'org.gimp.GIMP' },
      { capability: 'snap', label: 'gimp' }
    ]
    const warnings = detectDuplicateApps(items)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].layers.map((l) => l.capability).sort()).toEqual(['apt', 'flatpak', 'snap'])
  })

  it('does not flag two items in the same layer', () => {
    const items: DuplicateSourceItem[] = [
      { capability: 'apt', label: 'gimp' },
      { capability: 'apt', label: 'gimp-data' }
    ]
    expect(detectDuplicateApps(items)).toEqual([])
  })

  it('does not flag unrelated apps', () => {
    const items: DuplicateSourceItem[] = [
      { capability: 'apt', label: 'ripgrep' },
      { capability: 'flatpak', label: 'org.mozilla.firefox' }
    ]
    expect(detectDuplicateApps(items)).toEqual([])
  })

  it('ignores overly short names to avoid false positives', () => {
    const items: DuplicateSourceItem[] = [
      { capability: 'apt', label: 'at' },
      { capability: 'snap', label: 'cat' }
    ]
    expect(detectDuplicateApps(items)).toEqual([])
  })

  it('marks a warning as ignored when its canonical name is in the ignore set', () => {
    const items: DuplicateSourceItem[] = [
      { capability: 'apt', label: 'gimp' },
      { capability: 'flatpak', label: 'org.gimp.GIMP' }
    ]
    const warnings = detectDuplicateApps(items, new Set(['gimp']))
    expect(warnings[0].ignored).toBe(true)
  })
})

describe('detectDuplicates (live wiring)', () => {
  let fixture: TestFixture

  beforeEach(() => {
    // 무상태 분류(refactor-spec-v0.2 §1): fake provider 기본값은 전부
    // "사용자" 분류라 apt 항목이 걸러지지 않는다 — 구 baseline 프리셋 불필요.
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('combines apt/snap/flatpak/appimage live state and applies the ignore set', async () => {
    const providers = {
      apt: makeFakeAptProvider({ manual: ['gimp'] }),
      snap: makeFakeSnapProvider([{ name: 'gimp', notes: '-' }]),
      flatpak: makeFakeFlatpakProvider({
        apps: [{ application: 'org.gimp.GIMP', origin: 'flathub', installation: 'system' }]
      })
    }
    const gearLever = makeFakeGearLeverProvider({ installed: [] })

    const warnings = await detectDuplicates(fixture.ctx, providers, gearLever)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].layers).toHaveLength(3)
    expect(warnings[0].ignored).toBe(false)
  })

  it('excludes distro-classified apt packages from duplicate detection', async () => {
    const providers = {
      apt: makeFakeAptProvider({ manual: ['bash'], classify: { bash: 'distro' } }),
      snap: makeFakeSnapProvider([{ name: 'bash', notes: '-' }]),
      flatpak: makeFakeFlatpakProvider()
    }
    const warnings = await detectDuplicates(
      fixture.ctx,
      providers,
      makeFakeGearLeverProvider({ installed: [] })
    )
    expect(warnings).toEqual([])
  })

  it('respects a toggled ignore for a specific duplicate name', async () => {
    setIgnored(fixture.ctx, 'duplicates', 'names', 'gimp', true)
    const providers = {
      apt: makeFakeAptProvider({ manual: ['gimp'] }),
      snap: makeFakeSnapProvider([]),
      flatpak: makeFakeFlatpakProvider({
        apps: [{ application: 'org.gimp.GIMP', origin: 'flathub', installation: 'system' }]
      })
    }
    const warnings = await detectDuplicates(
      fixture.ctx,
      providers,
      makeFakeGearLeverProvider({ installed: [] })
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ignored).toBe(true)
  })
})
