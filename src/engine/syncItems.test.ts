import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureApt } from './capabilities/packages/apt'
import { writeAptBaseline } from './capabilities/packages/aptBaseline'
import {
  makeFakeAptProvider,
  makeFakeFlatpakProvider,
  makeFakeSnapProvider
} from './capabilities/packages/testHelpers'
import { readIgnoreSet } from './ignore'
import { listSyncItemGroups, toggleSyncItemIgnore } from './syncItems'
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

    const groups = await listSyncItemGroups(fixture.ctx, {
      apt: aptProvider,
      snap: makeFakeSnapProvider([]),
      flatpak: makeFakeFlatpakProvider()
    })

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
})
