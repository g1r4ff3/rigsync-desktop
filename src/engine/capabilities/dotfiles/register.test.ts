import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hostLayerPath,
  readCommonLayer,
  readHostLayer,
  writeCommonLayer,
  writeManifestFile
} from '../../manifest'
import { makeFixture, writeHomeFile, type TestFixture } from '../../testFixtures'
import { DOTFILES_LAYER } from './constants'
import {
  DotfileEntryNotRegisteredError,
  DotfileSecretScanBlockedError,
  registerDotfileEntry,
  unregisterDotfileEntry
} from './register'
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

describe('registerDotfileEntry (재캡처/upsert)', () => {
  it('manifest에 없는 home은 명시 에러로 거부한다(신규 등록은 이 배치 범위 밖)', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.zshrc', 'echo hi\n')

    expect(() => registerDotfileEntry(fixture.ctx, '~/.zshrc')).toThrow(
      DotfileEntryNotRegisteredError
    )
    fixture.cleanup()
  })

  it('기존(common) entry의 홈 내용을 store로 다시 복사한다', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.zshrc', 'echo updated\n')
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })

    registerDotfileEntry(fixture.ctx, '~/.zshrc')

    const storeAbs = path.join(fixture.manifestDir, 'dotfiles/.zshrc')
    expect(fs.readFileSync(storeAbs, 'utf-8')).toBe('echo updated\n')
    fixture.cleanup()
  })

  it('내용에 비밀 패턴이 있으면 재캡처를 거부하고 store를 바꾸지 않는다', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.zshrc', 'export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n')
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })
    const storeAbs = path.join(fixture.manifestDir, 'dotfiles/.zshrc')
    fs.mkdirSync(path.dirname(storeAbs), { recursive: true })
    fs.writeFileSync(storeAbs, 'echo original\n')

    expect(() => registerDotfileEntry(fixture.ctx, '~/.zshrc')).toThrow(
      DotfileSecretScanBlockedError
    )
    expect(fs.readFileSync(storeAbs, 'utf-8')).toBe('echo original\n')
    fixture.cleanup()
  })
})

describe('unregisterDotfileEntry', () => {
  it('common entry와 store payload를 지우지만 홈의 실제 파일은 건드리지 않는다', () => {
    const fixture = makeFixture('reference')
    const homeAbs = writeHomeFile(fixture, '.zshrc', 'echo hi\n')
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })
    const storeAbs = path.join(fixture.manifestDir, 'dotfiles/.zshrc')
    fs.mkdirSync(path.dirname(storeAbs), { recursive: true })
    fs.writeFileSync(storeAbs, 'echo hi\n')

    unregisterDotfileEntry(fixture.ctx, '~/.zshrc')

    expect(commonEntriesOf(fixture)).toHaveLength(0)
    expect(fs.existsSync(storeAbs)).toBe(false)
    expect(fs.existsSync(homeAbs)).toBe(true) // 홈 파일은 그대로.
    fixture.cleanup()
  })

  it('host-only entry도 지운다', () => {
    const fixture = makeFixture('reference')
    writeManifestFile(hostLayerPath(fixture.ctx, DOTFILES_LAYER), {
      entry: [
        {
          home: '~/.only-here',
          store: `hosts/testhost/dotfiles/.only-here`,
          type: 'file',
          link: true
        }
      ]
    })
    const storeAbs = path.join(fixture.manifestDir, 'hosts/testhost/dotfiles/.only-here')
    fs.mkdirSync(path.dirname(storeAbs), { recursive: true })
    fs.writeFileSync(storeAbs, 'x')

    unregisterDotfileEntry(fixture.ctx, '~/.only-here')

    expect(hostEntriesOf(fixture)).toHaveLength(0)
    expect(fs.existsSync(storeAbs)).toBe(false)
    fixture.cleanup()
  })

  it('없는 key를 지워도 멱등(no-op, 던지지 않음)', () => {
    const fixture = makeFixture('reference')
    expect(() => unregisterDotfileEntry(fixture.ctx, '~/.nope')).not.toThrow()
    fixture.cleanup()
  })
})
