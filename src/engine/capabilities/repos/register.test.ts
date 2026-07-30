import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readCommonLayer } from '../../manifest'
import { makeFixture } from '../../testFixtures'
import { REPOS_LAYER } from './constants'
import { RepoPathNotFoundError, RepoWorktreeNotSupportedError, registerRepoEntry } from './register'
import { makeFakeGitProvider } from './testHelpers'
import type { ReposManifest } from './types'

describe('registerRepoEntry', () => {
  it('.git이 있는 경로면 remote url·branch를 조회해 upsert한다', async () => {
    const fixture = makeFixture('reference')
    const repoAbs = path.join(fixture.homeDir, 'repos', 'foo')
    fs.mkdirSync(path.join(repoAbs, '.git'), { recursive: true })
    const provider = makeFakeGitProvider({
      remotes: { [repoAbs]: 'git@github.com:me/foo.git' },
      branches: { [repoAbs]: 'main' }
    })

    await registerRepoEntry(fixture.ctx, provider, '~/repos/foo')

    const doc = readCommonLayer(fixture.ctx, REPOS_LAYER) as ReposManifest
    expect(doc.repo).toEqual([
      { path: '~/repos/foo', url: 'git@github.com:me/foo.git', branch: 'main' }
    ])
    fixture.cleanup()
  })

  it('.git이 없는 경로는 거부한다', async () => {
    const fixture = makeFixture('reference')
    fs.mkdirSync(path.join(fixture.homeDir, 'repos', 'nogit'), { recursive: true })
    const provider = makeFakeGitProvider()

    await expect(registerRepoEntry(fixture.ctx, provider, '~/repos/nogit')).rejects.toThrow(
      RepoPathNotFoundError
    )
    fixture.cleanup()
  })

  it('worktree(.git이 파일)는 등록 대상이 아니다', async () => {
    const fixture = makeFixture('reference')
    const repoAbs = path.join(fixture.homeDir, 'repos', 'wt')
    fs.mkdirSync(repoAbs, { recursive: true })
    fs.writeFileSync(path.join(repoAbs, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n')
    const provider = makeFakeGitProvider()

    await expect(registerRepoEntry(fixture.ctx, provider, '~/repos/wt')).rejects.toThrow(
      RepoWorktreeNotSupportedError
    )
    fixture.cleanup()
  })
})
