import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { diffDotfiles } from './diff'
import { DOTFILES_LAYER } from './constants'
import {
  makeFixture,
  writeHomeFile,
  writeIgnore,
  writeSelection,
  type TestFixture
} from '../../testFixtures'

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

  // WS2("창고 모델" 구독 강제) 안전 규칙 1: 미구독 엔트리는 설치/드리프트
  // 판정에서만 skip한다 -- 어떤 diff 배열에도 나타나지 않는다(제거 신호도
  // 아니다, dotfiles diff엔 애초에 "제거" 배열이 없다).
  it('is silent for an unsubscribed managed entry (WS2 — not install, not drift)', async () => {
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    writeSelection(fixture, { mode: 'all', dotfiles: { exclude: ['~/.zshrc'] } })
    // 홈엔 아무 것도 없다 -- 구독됐다면 missingHome에 잡혔을 상황.

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.toLink).toEqual([])
    expect(diff.missingHome).toEqual([])
    expect(diff.contentChanged).toEqual([])
  })
})

// F3/D2-b: follower는 entry.link 값과 무관하게 항상 link=false(복사 배포)
// 의미론으로 판정한다 — 이미지 스냅샷 모델(follower 홈은 배포 결과물이지
// manifest로의 라이브 뷰가 아니다).
describe('diffDotfiles (follower role — F3/D2-b)', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('follower')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('treats a link:true file entry whose home is a symlink as contentChanged, never toLink', async () => {
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    const storePath = path.join(fixture.manifestDir, 'dotfiles', '.zshrc')
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    fs.writeFileSync(storePath, 'export FOO=1\n')
    const homePath = path.join(fixture.homeDir, '.zshrc')
    fs.symlinkSync(path.resolve(storePath), homePath)

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.contentChanged).toContain('~/.zshrc')
    expect(diff.toLink).toEqual([])
  })

  it('treats a link:true file entry with a missing home as missingHome, never toLink', async () => {
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    const storePath = path.join(fixture.manifestDir, 'dotfiles', '.zshrc')
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    fs.writeFileSync(storePath, 'export FOO=1\n')

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.missingHome).toContain('~/.zshrc')
    expect(diff.toLink).toEqual([])
  })

  it('treats a link:true dir entry (skills scenario) whose home is a symlink as contentChanged, never toLink', async () => {
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [
        { home: '~/.claude/skills', store: 'dotfiles/.claude/skills', type: 'dir', link: true }
      ]
    })
    const storeDir = path.join(fixture.manifestDir, 'dotfiles', '.claude', 'skills')
    fs.mkdirSync(path.join(storeDir, 'foo'), { recursive: true })
    fs.writeFileSync(path.join(storeDir, 'foo', 'SKILL.md'), 'content\n')
    const homePath = path.join(fixture.homeDir, '.claude', 'skills')
    fs.mkdirSync(path.dirname(homePath), { recursive: true })
    fs.symlinkSync(path.resolve(storeDir), homePath)

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.contentChanged).toContain('~/.claude/skills')
    expect(diff.toLink).toEqual([])
  })
})
