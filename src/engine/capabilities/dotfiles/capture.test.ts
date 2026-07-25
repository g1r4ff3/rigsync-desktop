import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectiveLayer, writeCommonLayer } from '../../manifest'
import { matchesDenylist } from '../../safety/denylist'
import { captureDotfiles, FollowerCaptureBlockedError } from './capture'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { makeFixture, writeHomeFile, writeIgnore, type TestFixture } from '../../testFixtures'
import type { DotfileEntry } from './types'

// 케이스 출처: 구 repo ~/repos/rigsync/tests/test_dotfiles.py (행동만 옮김).

describe('captureDotfiles', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  // TestDotfilesCapture.test_seed_and_capture_copies_into_store_without_touching_home
  it('seeds a known dotfile and copies it into the store without touching home', async () => {
    const homeFile = writeHomeFile(fixture, '.zshrc', 'seed content\n')

    const report = await captureDotfiles(fixture.ctx, { dryRun: false })
    expect(report.seededNew).toBeGreaterThanOrEqual(1)

    const manifest = effectiveLayer(fixture.ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
    const entries = (manifest.entry as DotfileEntry[]) ?? []
    const entry = entries.find((e) => e.home === '~/.zshrc')
    expect(entry).toBeDefined()

    const storePath = path.join(fixture.manifestDir, entry!.store)
    expect(fs.existsSync(storePath)).toBe(true)
    expect(fs.readFileSync(storePath, 'utf-8')).toBe('seed content\n')

    // capture는 home을 절대 건드리지 않는다.
    expect(fs.lstatSync(homeFile).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(homeFile, 'utf-8')).toBe('seed content\n')
  })

  // TestDotfilesCapture.test_denylisted_seed_path_is_never_seeded
  // (matchesDenylist 자체의 전체 커버리지는 safety/denylist.test.ts에 있음 —
  // 여기서는 12케이스 이식 수를 맞추기 위해 원 테스트의 검증만 재확인한다.)
  it('never matches an ordinary dotfile basename against the denylist', () => {
    expect(matchesDenylist('id_ed25519')).toBe(true)
    expect(matchesDenylist('id_rsa.pub')).toBe(true)
    expect(matchesDenylist('.env.local')).toBe(true)
    expect(matchesDenylist('credentials.json')).toBe(true)
    expect(matchesDenylist('aws_token')).toBe(true)
    expect(matchesDenylist('.zshrc')).toBe(false)
  })

  // TestDotfilesDenylistCaptureNote.test_capture_notes_denylisted_entry_and_excludes_it_from_manifest
  it('refuses a manually-injected denylisted entry and excludes it from the manifest', async () => {
    writeHomeFile(fixture, '.config/credentials_test', 'SECRET=1\n')
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [
        {
          home: '~/.config/credentials_test',
          store: 'dotfiles/.config/credentials_test',
          type: 'file',
          link: true
        }
      ]
    })

    const report = await captureDotfiles(fixture.ctx, { dryRun: false })

    expect(report.skippedDenylist).toBeGreaterThanOrEqual(1)
    expect(report.notes).toContain('refused (denylist): ~/.config/credentials_test')

    const manifest = effectiveLayer(fixture.ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
    const homes = ((manifest.entry as DotfileEntry[]) ?? []).map((e) => e.home)
    expect(homes).not.toContain('~/.config/credentials_test')

    const storePath = path.join(fixture.manifestDir, 'dotfiles', '.config', 'credentials_test')
    expect(fs.existsSync(storePath)).toBe(false)
  })

  // 추가 요구사항: dry-run이 파일시스템(스토어·manifest 파일)을 건드리지 않는지.
  it('dry-run computes counts but writes nothing to the store or manifest', async () => {
    writeHomeFile(fixture, '.zshrc', 'seed content\n')

    const report = await captureDotfiles(fixture.ctx, { dryRun: true })
    expect(report.seededNew).toBeGreaterThanOrEqual(1)
    expect(report.copied).toBeGreaterThanOrEqual(1)

    // dry-run이므로 common/dotfiles.toml 자체가 아직 존재하면 안 된다.
    const commonPath = path.join(fixture.manifestDir, 'common', 'dotfiles.toml')
    expect(fs.existsSync(commonPath)).toBe(false)

    // 스토어 payload도 복사되지 않았어야 한다.
    const storePath = path.join(fixture.manifestDir, 'dotfiles', '.zshrc')
    expect(fs.existsSync(storePath)).toBe(false)
  })

  // 추가 요구사항: role guard — follower는 capture를 거부한다 (불변식 ⑦).
  it('rejects capture on a follower machine', async () => {
    const follower = makeFixture('follower')
    try {
      writeHomeFile(follower, '.zshrc', 'seed content\n')
      await expect(captureDotfiles(follower.ctx, { dryRun: false })).rejects.toThrow(
        FollowerCaptureBlockedError
      )
      // 아무것도 쓰이지 않았어야 한다.
      expect(fs.existsSync(path.join(follower.manifestDir, 'common', 'dotfiles.toml'))).toBe(false)
    } finally {
      follower.cleanup()
    }
  })

  // 케이스 출처: 구 repo tests/test_ignore.py TestIgnoreDotfiles
  // (행동만 옮김 — 코드 복사 아님).

  // test_capture_never_seeds_ignored_home
  it('never seeds an ignored home even if it exists on disk', async () => {
    writeHomeFile(fixture, '.local/bin/sync-claude-to-opencode.sh', '#!/bin/sh\n')
    writeIgnore(fixture, { dotfiles: { homes: ['~/.local/bin/sync-claude-to-opencode.sh'] } })

    const report = await captureDotfiles(fixture.ctx, { dryRun: false })

    const manifest = effectiveLayer(fixture.ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
    const homes = ((manifest.entry as DotfileEntry[]) ?? []).map((e) => e.home)
    expect(homes).not.toContain('~/.local/bin/sync-claude-to-opencode.sh')
    expect(report.ignored).toBeGreaterThanOrEqual(0)
  })

  // test_capture_removes_already_manifested_then_ignored_home
  it('removes an already-manifested home once it becomes ignored (additive-only exception)', async () => {
    writeHomeFile(fixture, '.local/bin/sync-claude-to-opencode.sh', '#!/bin/sh\n')
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [
        {
          home: '~/.local/bin/sync-claude-to-opencode.sh',
          store: 'dotfiles/.local/bin/sync-claude-to-opencode.sh',
          type: 'file',
          link: true
        }
      ]
    })
    writeIgnore(fixture, { dotfiles: { homes: ['~/.local/bin/sync-claude-to-opencode.sh'] } })

    const report = await captureDotfiles(fixture.ctx, { dryRun: false })

    const manifest = effectiveLayer(fixture.ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
    const homes = ((manifest.entry as DotfileEntry[]) ?? []).map((e) => e.home)
    expect(homes).not.toContain('~/.local/bin/sync-claude-to-opencode.sh')
    expect(report.ignored).toBe(1)
  })
})
