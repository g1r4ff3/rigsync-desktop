/**
 * manifest dirty 검사(P3/D2-a) -- follower/reference 표현이 다른 게 핵심(스펙 명시):
 * follower dirty = warn(다음 pull 실패 경고), reference dirty = 중립 note(P4가 처리).
 */
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../testFixtures'
import { makeFakeGitTransportProvider } from '../transport/testHelpers'
import { checkManifestDirty } from './manifestDirtyCheck'

describe('checkManifestDirty', () => {
  it('is clean when the manifest dir is not a git repo', () => {
    const fixture = makeFixture('reference')
    const result = checkManifestDirty(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: false })
    )
    expect(result).toEqual({ role: 'reference', dirty: false, files: [] })
    fixture.cleanup()
  })

  it('is clean when the git repo has no changed files', () => {
    const fixture = makeFixture('reference')
    const result = checkManifestDirty(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: true, changedFiles: [] })
    )
    expect(result.dirty).toBe(false)
    expect(result.warning).toBeUndefined()
    expect(result.note).toBeUndefined()
    fixture.cleanup()
  })

  it('warns for a dirty follower manifest (F3 병인) and lists the changed files', () => {
    const fixture = makeFixture('follower')
    const files = [
      { status: ' M', path: 'dotfiles/.zshrc' },
      { status: '??', path: 'dotfiles/.newfile' }
    ]
    const result = checkManifestDirty(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: true, changedFiles: files })
    )
    expect(result.dirty).toBe(true)
    expect(result.files).toEqual(files)
    expect(result.warning).toBeDefined()
    expect(result.warning).toContain('pull')
    expect(result.warning).toContain('dotfiles/.zshrc')
    expect(result.note).toBeUndefined()
    fixture.cleanup()
  })

  it('gives a neutral note (not a warning) for a dirty reference manifest', () => {
    const fixture = makeFixture('reference')
    const files = [{ status: ' M', path: 'dotfiles/.zshrc' }]
    const result = checkManifestDirty(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: true, changedFiles: files })
    )
    expect(result.dirty).toBe(true)
    expect(result.note).toBeDefined()
    expect(result.note).toContain('자동으로 커밋')
    expect(result.warning).toBeUndefined()
    fixture.cleanup()
  })

  it('truncates the file list in the message to the first 5 entries', () => {
    const fixture = makeFixture('follower')
    const files = Array.from({ length: 7 }, (_, i) => ({ status: ' M', path: `f${i}.toml` }))
    const result = checkManifestDirty(
      fixture.ctx,
      makeFakeGitTransportProvider({ isGitRepo: true, changedFiles: files })
    )
    expect(result.files).toHaveLength(7)
    expect(result.warning).toContain('외 2개')
    fixture.cleanup()
  })
})
