import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { effectiveLayer, readCommonLayer, readHostLayer, writeCommonLayer } from '../../manifest'
import { makeFixture, writeHomeFile, type TestFixture } from '../../testFixtures'
import { FollowerHostLayerMoveBlockedError, HostLayerEntryNotFoundError } from '../hostLayerErrors'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { moveDotfileEntryToCommonLayer, moveDotfileEntryToHostLayer } from './hostLayer'
import type { DotfileEntry } from './types'

function seedCommonEntry(fixture: TestFixture, entry: DotfileEntry): void {
  writeCommonLayer(fixture.ctx, DOTFILES_LAYER, { entry: [entry] })
}

function commonEntriesOf(fixture: TestFixture): DotfileEntry[] {
  const doc = readCommonLayer(fixture.ctx, DOTFILES_LAYER)
  return (doc.entry as DotfileEntry[] | undefined) ?? []
}

function hostEntriesOf(fixture: TestFixture): DotfileEntry[] {
  const doc = readHostLayer(fixture.ctx, DOTFILES_LAYER)
  return (doc.entry as DotfileEntry[] | undefined) ?? []
}

// F2 (docs/refactor-spec-v0.2.md) — "이 머신 전용" 전환의 엔진 연산.

describe('moveDotfileEntryToHostLayer / moveDotfileEntryToCommonLayer', () => {
  it('rejects on a follower machine', () => {
    const fixture = makeFixture('follower')
    expect(() => moveDotfileEntryToHostLayer(fixture.ctx, '~/.zshrc')).toThrow(
      FollowerHostLayerMoveBlockedError
    )
    expect(() => moveDotfileEntryToCommonLayer(fixture.ctx, '~/.zshrc')).toThrow(
      FollowerHostLayerMoveBlockedError
    )
    fixture.cleanup()
  })

  it('throws when the entry does not exist in the source layer', () => {
    const fixture = makeFixture('reference')
    expect(() => moveDotfileEntryToHostLayer(fixture.ctx, '~/.nope')).toThrow(
      HostLayerEntryNotFoundError
    )
    expect(() => moveDotfileEntryToCommonLayer(fixture.ctx, '~/.nope')).toThrow(
      HostLayerEntryNotFoundError
    )
    fixture.cleanup()
  })

  it('moves the entry + store payload common -> host -> common (round trip)', () => {
    const fixture = makeFixture('reference')
    const storeDir = path.join(fixture.manifestDir, 'dotfiles')
    fs.mkdirSync(storeDir, { recursive: true })
    fs.writeFileSync(path.join(storeDir, '.zshrc'), 'zshrc content\n')
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })

    moveDotfileEntryToHostLayer(fixture.ctx, '~/.zshrc')

    expect(commonEntriesOf(fixture)).toHaveLength(0)
    const hostEntries = hostEntriesOf(fixture)
    expect(hostEntries).toHaveLength(1)
    expect(hostEntries[0].store).toBe('hosts/testhost/dotfiles/.zshrc')
    const hostStoreAbs = path.join(fixture.manifestDir, 'hosts/testhost/dotfiles/.zshrc')
    expect(fs.existsSync(hostStoreAbs)).toBe(true)
    expect(fs.readFileSync(hostStoreAbs, 'utf-8')).toBe('zshrc content\n')
    // 원본 store 파일은 옮겨져 더 이상 남아있지 않다(git mv 상당).
    expect(fs.existsSync(path.join(storeDir, '.zshrc'))).toBe(false)

    moveDotfileEntryToCommonLayer(fixture.ctx, '~/.zshrc')

    expect(hostEntriesOf(fixture)).toHaveLength(0)
    const commonEntries = commonEntriesOf(fixture)
    expect(commonEntries).toHaveLength(1)
    expect(commonEntries[0].store).toBe('dotfiles/.zshrc')
    expect(fs.existsSync(path.join(storeDir, '.zshrc'))).toBe(true)
    expect(fs.readFileSync(path.join(storeDir, '.zshrc'), 'utf-8')).toBe('zshrc content\n')
    expect(fs.existsSync(hostStoreAbs)).toBe(false)

    fixture.cleanup()
  })

  it('rewrites the reference home symlink to the moved store path (host)', () => {
    const fixture = makeFixture('reference')
    const storeDir = path.join(fixture.manifestDir, 'dotfiles')
    fs.mkdirSync(storeDir, { recursive: true })
    const storeFile = path.join(storeDir, '.zshrc')
    fs.writeFileSync(storeFile, 'linked content\n')
    const homePath = path.join(fixture.homeDir, '.zshrc')
    fs.symlinkSync(path.resolve(storeFile), homePath)
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })

    moveDotfileEntryToHostLayer(fixture.ctx, '~/.zshrc')

    expect(fs.lstatSync(homePath).isSymbolicLink()).toBe(true)
    const newStoreAbs = path.join(fixture.manifestDir, 'hosts/testhost/dotfiles/.zshrc')
    expect(fs.readlinkSync(homePath)).toBe(path.resolve(newStoreAbs))
    expect(fs.readFileSync(homePath, 'utf-8')).toBe('linked content\n')

    fixture.cleanup()
  })

  it('rewrites the reference home symlink back on the return trip (host -> common)', () => {
    const fixture = makeFixture('reference')
    const storeFile = path.join(fixture.manifestDir, 'dotfiles/.zshrc')
    fs.mkdirSync(path.dirname(storeFile), { recursive: true })
    fs.writeFileSync(storeFile, 'linked content\n')
    const homePath = path.join(fixture.homeDir, '.zshrc')
    fs.symlinkSync(path.resolve(storeFile), homePath)
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })

    moveDotfileEntryToHostLayer(fixture.ctx, '~/.zshrc')
    moveDotfileEntryToCommonLayer(fixture.ctx, '~/.zshrc')

    expect(fs.lstatSync(homePath).isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(homePath)).toBe(path.resolve(storeFile))
    expect(fs.readFileSync(homePath, 'utf-8')).toBe('linked content\n')

    fixture.cleanup()
  })

  it('does not touch home for a copy-mode (link=false) entry', () => {
    const fixture = makeFixture('reference')
    const storeDir = path.join(fixture.manifestDir, 'dotfiles')
    fs.mkdirSync(storeDir, { recursive: true })
    fs.writeFileSync(path.join(storeDir, '.bashrc'), 'copy content\n')
    const homePath = writeHomeFile(fixture, '.bashrc', 'copy content\n')
    seedCommonEntry(fixture, {
      home: '~/.bashrc',
      store: 'dotfiles/.bashrc',
      type: 'file',
      link: false,
      mode: '644'
    })

    moveDotfileEntryToHostLayer(fixture.ctx, '~/.bashrc')

    expect(fs.lstatSync(homePath).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(homePath, 'utf-8')).toBe('copy content\n')

    fixture.cleanup()
  })

  it('effectiveLayer merges the host-only entry for this machine but not for a different machine', () => {
    const fixture = makeFixture('reference')
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })

    moveDotfileEntryToHostLayer(fixture.ctx, '~/.zshrc')

    const merged = effectiveLayer(fixture.ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
    const mergedHomes = ((merged.entry as DotfileEntry[] | undefined) ?? []).map((e) => e.home)
    expect(mergedHomes).toContain('~/.zshrc')

    const otherHostCtx = { ...fixture.ctx, machineId: 'other-host' }
    const mergedOther = effectiveLayer(otherHostCtx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
    const mergedOtherHomes = ((mergedOther.entry as DotfileEntry[] | undefined) ?? []).map(
      (e) => e.home
    )
    expect(mergedOtherHomes).not.toContain('~/.zshrc')

    fixture.cleanup()
  })

  it('never leaves the entry present in both common and host at once', () => {
    const fixture = makeFixture('reference')
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })

    moveDotfileEntryToHostLayer(fixture.ctx, '~/.zshrc')

    const inCommon = commonEntriesOf(fixture).some((e) => e.home === '~/.zshrc')
    const inHost = hostEntriesOf(fixture).some((e) => e.home === '~/.zshrc')
    expect(inCommon).toBe(false)
    expect(inHost).toBe(true)

    moveDotfileEntryToCommonLayer(fixture.ctx, '~/.zshrc')

    const inCommon2 = commonEntriesOf(fixture).some((e) => e.home === '~/.zshrc')
    const inHost2 = hostEntriesOf(fixture).some((e) => e.home === '~/.zshrc')
    expect(inCommon2).toBe(true)
    expect(inHost2).toBe(false)

    fixture.cleanup()
  })
})
