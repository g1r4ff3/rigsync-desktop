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
import { readSelectionFilter } from '../../selection'
import { makeFixture, writeHomeFile, type TestFixture } from '../../testFixtures'
import { DOTFILES_LAYER } from './constants'
import { hostDotfileStoreRelPath } from './hostLayer'
import {
  DotfileEntryNotRegisteredError,
  DotfileSecretScanBlockedError,
  registerDotfileEntry,
  registerNewDotfile,
  scanDotfileCandidateForSecrets,
  unregisterDotfileEntry,
  validateDotfileRegistration
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

// WS6("창고 모델 1차"): dotfiles 임의 경로 등록 — validateDotfileRegistration
// (순수 검증) + registerNewDotfile(payload 먼저 → 엔트리 나중 → 자동 구독).

describe('validateDotfileRegistration', () => {
  it('존재하지 않는 경로는 not-found로 거부한다', () => {
    const fixture = makeFixture('reference')
    const check = validateDotfileRegistration(fixture.ctx, '~/.nope')
    expect(check).toMatchObject({ ok: false, reason: 'not-found', homeKey: '~/.nope' })
    fixture.cleanup()
  })

  it('존재하는 파일은 file 타입·정규화된 home 키로 허용한다', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.newrc', 'echo hi\n')
    const check = validateDotfileRegistration(fixture.ctx, '~/.newrc')
    expect(check).toEqual({ ok: true, homeKey: '~/.newrc', type: 'file' })
    fixture.cleanup()
  })

  it('디렉터리는 dir 타입으로 판별한다', () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.homeDir, '.config', 'newdir'), { recursive: true })
    const check = validateDotfileRegistration(fixture.ctx, '~/.config/newdir')
    expect(check).toEqual({ ok: true, homeKey: '~/.config/newdir', type: 'dir' })
    fixture.cleanup()
  })

  it('절대경로 입력도 homeDir 기준으로 정규화한다(피커가 절대경로를 줄 때)', () => {
    const fixture = makeFixture('reference')
    const abs = writeHomeFile(fixture, '.absrc', 'x')
    const check = validateDotfileRegistration(fixture.ctx, abs)
    expect(check).toEqual({ ok: true, homeKey: '~/.absrc', type: 'file' })
    fixture.cleanup()
  })

  it('homeDir 밖 경로는 outside-home으로 거부하고 homeKey를 채우지 않는다', () => {
    const fixture = makeFixture('reference')
    const check = validateDotfileRegistration(fixture.ctx, '~/../outside')
    expect(check.ok).toBe(false)
    expect(check.reason).toBe('outside-home')
    expect(check.homeKey).toBeUndefined()
    fixture.cleanup()
  })

  it('manifestDir 자신/내부는 manifest-internal로 거부한다', () => {
    const fixture = makeFixture('reference')
    // manifestDir이 homeDir 밖(별도 temp 서브디렉터리)이라 이 케이스는 성립하지
    // 않는다 — homeDir 내부에 manifestDir을 재배치해 케이스를 만든다.
    const innerManifest = path.join(fixture.homeDir, '.local', 'share', 'rigsync-manifest')
    fs.mkdirSync(innerManifest, { recursive: true })
    const ctx = { ...fixture.ctx, manifestDir: innerManifest }
    const check = validateDotfileRegistration(ctx, '~/.local/share/rigsync-manifest')
    expect(check).toMatchObject({ ok: false, reason: 'manifest-internal' })
    fixture.cleanup()
  })

  it('secret denylist 이름(id_ed25519 등)은 denylist 사유로 거부한다', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.ssh/id_ed25519', 'fake-key')
    const check = validateDotfileRegistration(fixture.ctx, '~/.ssh/id_ed25519')
    expect(check).toMatchObject({ ok: false, reason: 'denylist', homeKey: '~/.ssh/id_ed25519' })
    fixture.cleanup()
  })

  it('이미 managed(common)인 경로는 already-managed로 거부한다', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.zshrc', 'x')
    seedCommonEntry(fixture, {
      home: '~/.zshrc',
      store: 'dotfiles/.zshrc',
      type: 'file',
      link: true
    })
    const check = validateDotfileRegistration(fixture.ctx, '~/.zshrc')
    expect(check).toMatchObject({ ok: false, reason: 'already-managed' })
    fixture.cleanup()
  })

  it('기존 managed 디렉터리 엔트리 내부 경로는 inside-managed-entry로 거부한다', () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.homeDir, '.config', 'wezterm'), { recursive: true })
    fs.writeFileSync(path.join(fixture.homeDir, '.config', 'wezterm', 'wezterm.lua'), 'x')
    seedCommonEntry(fixture, {
      home: '~/.config/wezterm',
      store: 'dotfiles/.config/wezterm',
      type: 'dir',
      link: true
    })
    const check = validateDotfileRegistration(fixture.ctx, '~/.config/wezterm/wezterm.lua')
    expect(check).toMatchObject({ ok: false, reason: 'inside-managed-entry' })
    fixture.cleanup()
  })

  it('기존 managed 엔트리를 품는 상위 디렉터리 등록도 inside-managed-entry로 거부한다(반대 방향)', () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.homeDir, '.config', 'foo'), { recursive: true })
    seedCommonEntry(fixture, {
      home: '~/.config/foo/bar.toml',
      store: 'dotfiles/.config/foo/bar.toml',
      type: 'file',
      link: true
    })
    const check = validateDotfileRegistration(fixture.ctx, '~/.config/foo')
    expect(check).toMatchObject({ ok: false, reason: 'inside-managed-entry' })
    fixture.cleanup()
  })
})

describe('scanDotfileCandidateForSecrets', () => {
  it('비밀 패턴이 있으면 findings를 돌려준다(store에 쓰지 않고 검사만)', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.newsecret', 'export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\n')
    const findings = scanDotfileCandidateForSecrets(fixture.ctx, '~/.newsecret')
    expect(findings.length).toBeGreaterThan(0)
    fixture.cleanup()
  })

  it('깨끗한 파일은 빈 배열', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.newclean', 'echo hi\n')
    expect(scanDotfileCandidateForSecrets(fixture.ctx, '~/.newclean')).toEqual([])
    fixture.cleanup()
  })
})

describe('registerNewDotfile', () => {
  it('payload를 store로 복사하고 common entry를 만들고 자동 구독한다', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.newrc', 'echo hi\n')

    registerNewDotfile(fixture.ctx, { homePath: '~/.newrc', link: true, host: false })

    const entries = commonEntriesOf(fixture)
    expect(entries).toEqual([
      { home: '~/.newrc', store: 'dotfiles/.newrc', type: 'file', link: true }
    ])
    const storeAbs = path.join(fixture.manifestDir, 'dotfiles/.newrc')
    expect(fs.readFileSync(storeAbs, 'utf-8')).toBe('echo hi\n')

    // 자동 구독 — mode='all'(기본)에서는 exclude에 없음 == 구독.
    const filter = readSelectionFilter(fixture.ctx, 'dotfiles')
    expect(filter.exclude.has('~/.newrc')).toBe(false)
    fixture.cleanup()
  })

  it('host=true면 hosts/<machineId>/dotfiles/<rel>에 담고 host 계층 entry를 만든다', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.hostonly', 'x')

    registerNewDotfile(fixture.ctx, { homePath: '~/.hostonly', link: true, host: true })

    expect(commonEntriesOf(fixture)).toHaveLength(0)
    const hostEntries = hostEntriesOf(fixture)
    const expectedStore = hostDotfileStoreRelPath(fixture.ctx, '~/.hostonly')
    expect(hostEntries).toEqual([
      { home: '~/.hostonly', store: expectedStore, type: 'file', link: true }
    ])
    expect(fs.existsSync(path.join(fixture.manifestDir, expectedStore))).toBe(true)
    fixture.cleanup()
  })

  it('link=false로 등록하면 entry.link=false로 저장된다(copy-mode)', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.copyrc', 'x')
    registerNewDotfile(fixture.ctx, { homePath: '~/.copyrc', link: false, host: false })
    expect(commonEntriesOf(fixture)[0]?.link).toBe(false)
    fixture.cleanup()
  })

  it('디렉터리 등록은 트리 전체를 store로 복사한다', () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.homeDir, '.config', 'newtool'), { recursive: true })
    fs.writeFileSync(path.join(fixture.homeDir, '.config', 'newtool', 'a.toml'), 'x')

    registerNewDotfile(fixture.ctx, { homePath: '~/.config/newtool', link: true, host: false })

    expect(commonEntriesOf(fixture)).toEqual([
      { home: '~/.config/newtool', store: 'dotfiles/.config/newtool', type: 'dir', link: true }
    ])
    expect(
      fs.readFileSync(path.join(fixture.manifestDir, 'dotfiles/.config/newtool/a.toml'), 'utf-8')
    ).toBe('x')
    fixture.cleanup()
  })

  it('검증에 실패하는 경로는 store·manifest 어느 쪽도 건드리지 않고 던진다', () => {
    const fixture = makeFixture('reference')
    expect(() =>
      registerNewDotfile(fixture.ctx, { homePath: '~/.nope', link: true, host: false })
    ).toThrow()
    expect(commonEntriesOf(fixture)).toHaveLength(0)
    fixture.cleanup()
  })

  it('upsert 성격 — 같은 경로를 다시 등록하면 기존 entry를 대체한다(중복 추가 안 함)', () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.rerc', 'v1')
    registerNewDotfile(fixture.ctx, { homePath: '~/.rerc', link: true, host: false })
    unregisterDotfileEntry(fixture.ctx, '~/.rerc') // 다시 미관리로.
    writeHomeFile(fixture, '.rerc', 'v2')
    registerNewDotfile(fixture.ctx, { homePath: '~/.rerc', link: true, host: false })
    expect(commonEntriesOf(fixture)).toHaveLength(1)
    fixture.cleanup()
  })
})
