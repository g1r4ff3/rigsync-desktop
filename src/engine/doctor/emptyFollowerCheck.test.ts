/**
 * "빈 follower" doctor 체크 -- follower/reference 구분이 핵심(스펙 명시):
 * follower의 빈 manifest는 경고, reference의 빈 manifest(첫 capture 전)는 정상.
 */
import { describe, expect, it } from 'vitest'
import { DOTFILES_LAYER } from '../capabilities/dotfiles/constants'
import { writeCommonLayer } from '../manifest'
import { makeFixture } from '../testFixtures'
import { makeFakeGitTransportProvider } from '../transport/testHelpers'
import { checkEmptyFollower } from './emptyFollowerCheck'

describe('checkEmptyFollower', () => {
  it('warns for a follower whose manifest is empty and has no remote (the real-world bug)', async () => {
    const fixture = makeFixture('follower')
    const result = await checkEmptyFollower(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: false, hasRemote: false })
    )
    expect(result.applicable).toBe(true)
    expect(result.declarationsTotal).toBe(0)
    expect(result.hasRemote).toBe(false)
    expect(result.warning).toBeDefined()
    expect(result.warning).toContain('클론')
    fixture.cleanup()
  })

  it('warns for a follower with declarations but still no remote', async () => {
    const fixture = makeFixture('follower')
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file' }]
    })
    const result = await checkEmptyFollower(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: true, hasRemote: false })
    )
    expect(result.declarationsTotal).toBe(1)
    expect(result.hasRemote).toBe(false)
    expect(result.warning).toBeDefined()
    fixture.cleanup()
  })

  it('does not warn for a follower with declarations and a remote (healthy state)', async () => {
    const fixture = makeFixture('follower')
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file' }]
    })
    const result = await checkEmptyFollower(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: true, hasRemote: true })
    )
    expect(result.warning).toBeUndefined()
    fixture.cleanup()
  })

  it('does not warn for a reference machine with an empty manifest (normal pre-first-capture state)', async () => {
    const fixture = makeFixture('reference')
    const result = await checkEmptyFollower(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: false, hasRemote: false })
    )
    expect(result.applicable).toBe(false)
    expect(result.warning).toBeUndefined()
    fixture.cleanup()
  })
})
