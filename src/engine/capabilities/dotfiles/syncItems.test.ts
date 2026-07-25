import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, writeHomeFile, writeIgnore, type TestFixture } from '../../testFixtures'
import { captureDotfiles } from './capture'
import { buildDotfilesSyncGroup } from './syncItems'

// 신규 테스트 (구 repo엔 이 화면이 없었음) — P2a 결정 ⑤ "동기화 항목" 화면의
// dotfiles 그룹.

describe('buildDotfilesSyncGroup', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('returns null when there is nothing managed or candidate', () => {
    expect(buildDotfilesSyncGroup(fixture.ctx)).toBeNull()
  })

  it('lists a managed entry and an unmanaged seed candidate, marking ignored ones', async () => {
    writeHomeFile(fixture, '.zshrc', 'seed content\n')
    await captureDotfiles(fixture.ctx, { dryRun: false }) // "~/.zshrc" becomes managed

    writeHomeFile(fixture, '.gitconfig', '[user]\n') // seed candidate, not yet captured
    writeIgnore(fixture, { dotfiles: { homes: ['~/.gitconfig'] } })

    const group = buildDotfilesSyncGroup(fixture.ctx)
    expect(group).not.toBeNull()
    const byKey = new Map(group!.items.map((i) => [i.key, i]))

    expect(byKey.get('~/.zshrc')).toEqual({
      key: '~/.zshrc',
      label: '~/.zshrc',
      managed: true,
      ignored: false
    })
    // 후보(candidate)면서 ignore도 된 항목 -- 화면엔 여전히 나타나야 한다.
    expect(byKey.get('~/.gitconfig')).toEqual({
      key: '~/.gitconfig',
      label: '~/.gitconfig',
      managed: false,
      ignored: true
    })
  })
})
