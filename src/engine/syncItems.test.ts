import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFakeGearLeverProvider } from './capabilities/appimage/testHelpers'
import { captureApt } from './capabilities/packages/apt'
import { writeAptBaseline } from './capabilities/packages/aptBaseline'
import {
  makeFakeAptProvider,
  makeFakeFlatpakProvider,
  makeFakeSnapProvider
} from './capabilities/packages/testHelpers'
import { makeFakeToolsProvider } from './capabilities/tools/testHelpers'
import { readIgnoreSet } from './ignore'
import { listSyncItemGroups, toggleSyncItemIgnore, toggleSyncItemIgnoreBulk } from './syncItems'
import { makeFixture, type TestFixture } from './testFixtures'

describe('listSyncItemGroups / toggleSyncItemIgnore', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('combines dotfiles + package groups, dotfiles first', async () => {
    writeAptBaseline(fixture.ctx, []) // P2c: baseline 없으면 첫 capture가 스냅샷만 하고 끝난다
    const aptProvider = makeFakeAptProvider({ manual: ['git'] })
    await captureApt(fixture.ctx, aptProvider, { dryRun: false })

    const groups = await listSyncItemGroups(
      fixture.ctx,
      {
        apt: aptProvider,
        snap: makeFakeSnapProvider([]),
        flatpak: makeFakeFlatpakProvider()
      },
      makeFakeGearLeverProvider({ available: false }),
      makeFakeToolsProvider({ available: false })
    )

    // dotfiles 그룹이 없으면(관리 항목·후보 둘 다 없으면) 생략되고, apt만 남는다.
    expect(groups.map((g) => g.capability)).toEqual(['apt'])
  })

  it('toggling a package item writes common ignore.toml under the right kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'apt', 'zoom', true)
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(new Set(['zoom']))

    toggleSyncItemIgnore(fixture.ctx, 'apt', 'zoom', false)
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(new Set())
  })

  it('toggling a flatpak item writes under the "apps" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'flatpak', 'org.deskflow.deskflow', true)
    expect(readIgnoreSet(fixture.ctx, 'flatpak', 'apps')).toEqual(
      new Set(['org.deskflow.deskflow'])
    )
  })

  it('toggling a dotfiles item writes under the "homes" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'dotfiles', '~/.zshrc', true)
    expect(readIgnoreSet(fixture.ctx, 'dotfiles', 'homes')).toEqual(new Set(['~/.zshrc']))
  })

  it('toggling an appimage item writes under the "names" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'appimage', 'tev.desktop', true)
    expect(readIgnoreSet(fixture.ctx, 'appimage', 'names')).toEqual(new Set(['tev.desktop']))
  })

  it('includes an appimage group when Gear Lever has installed apps', async () => {
    const gearLever = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'tev (2.13.1)',
          path: '/home/cglab/AppImages/tev.appimage',
          desktopId: 'tev.desktop',
          currentVersion: '2.13.1',
          availableVersion: null,
          downloadSize: null,
          manager: 'GithubUpdater',
          embeddedSource: false,
          running: false
        }
      ]
    })
    const groups = await listSyncItemGroups(
      fixture.ctx,
      {
        apt: makeFakeAptProvider({ available: false }),
        snap: makeFakeSnapProvider([], false),
        flatpak: makeFakeFlatpakProvider({ available: false })
      },
      gearLever,
      makeFakeToolsProvider({ available: false })
    )
    expect(groups.map((g) => g.capability)).toEqual(['appimage'])
    expect(groups[0].items[0]).toEqual({
      key: 'tev.desktop',
      label: 'tev.desktop',
      managed: false,
      ignored: false
    })
  })

  it('toggling a tools item writes under the "packages" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'tools', 'claude-mermaid', true)
    expect(readIgnoreSet(fixture.ctx, 'tools', 'packages')).toEqual(new Set(['claude-mermaid']))
  })

  it('toggling a repos item writes under the "paths" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'repos', '~/repos/scratch', true)
    expect(readIgnoreSet(fixture.ctx, 'repos', 'paths')).toEqual(new Set(['~/repos/scratch']))
  })

  it('includes a tools group when npm globals are present', async () => {
    const groups = await listSyncItemGroups(
      fixture.ctx,
      {
        apt: makeFakeAptProvider({ available: false }),
        snap: makeFakeSnapProvider([], false),
        flatpak: makeFakeFlatpakProvider({ available: false })
      },
      makeFakeGearLeverProvider({ available: false }),
      makeFakeToolsProvider({ available: true, globals: { pnpm: '10' } })
    )
    expect(groups.map((g) => g.capability)).toEqual(['tools'])
    expect(groups[0].items[0]).toEqual({
      key: 'pnpm',
      label: 'pnpm',
      managed: false,
      ignored: false
    })
  })

  it('toggleSyncItemIgnoreBulk ignores every key in a group in one shot, under the right kind', () => {
    toggleSyncItemIgnoreBulk(fixture.ctx, 'apt', ['zoom', 'unityhub', 'firefox'], true)
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(
      new Set(['firefox', 'unityhub', 'zoom'])
    )
  })

  it('toggleSyncItemIgnoreBulk un-ignores in one shot, leaving other capabilities untouched', () => {
    toggleSyncItemIgnoreBulk(fixture.ctx, 'apt', ['zoom', 'unityhub'], true)
    toggleSyncItemIgnore(fixture.ctx, 'flatpak', 'org.deskflow.deskflow', true)
    toggleSyncItemIgnoreBulk(fixture.ctx, 'apt', ['zoom'], false)
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(new Set(['unityhub']))
    expect(readIgnoreSet(fixture.ctx, 'flatpak', 'apps')).toEqual(
      new Set(['org.deskflow.deskflow'])
    )
  })

  it('toggleSyncItemIgnoreBulk on a detection-only capability (snap) still writes ignore.toml', () => {
    toggleSyncItemIgnoreBulk(fixture.ctx, 'snap', ['code', 'discord'], true)
    expect(readIgnoreSet(fixture.ctx, 'snap', 'packages')).toEqual(new Set(['code', 'discord']))
  })
})
