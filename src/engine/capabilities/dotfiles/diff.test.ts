import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { diffDotfiles } from './diff'
import { DOTFILES_LAYER } from './constants'
import { makeFixture, writeHomeFile, writeIgnore, type TestFixture } from '../../testFixtures'

// 케이스 출처: 구 repo tests/test_dotfiles.py TestDotfilesInvalidStoreApplyRefusal
// (행동만 옮김 — 코드 복사 아님).

function injectEscapingEntry(fixture: TestFixture): string {
  const home = '~/.config/escape_test'
  writeHomeFile(fixture, '.config/escape_test', 'content\n')
  writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
    entry: [{ home, store: '../outside_repo/escape_test', type: 'file', link: true }]
  })
  return home
}

describe('diffDotfiles', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  // TestDotfilesInvalidStoreApplyRefusal.test_diff_flags_invalid_store
  it('flags an entry whose store field escapes the manifest root', async () => {
    const home = injectEscapingEntry(fixture)

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.invalidStore).toContain(home)
  })

  // 케이스 출처: 구 repo tests/test_ignore.py
  // TestIgnoreDotfiles.test_diff_silent_for_ignored_home (행동만 옮김).
  it('is silent for an ignored home (not drift, not missing)', async () => {
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

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.toLink).toEqual([])
    expect(diff.missingHome).toEqual([])
  })
})
