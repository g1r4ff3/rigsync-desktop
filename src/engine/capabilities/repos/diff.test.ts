import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { contractHome } from '../../paths'
import { diffRepos } from './diff'
import { REPOS_LAYER } from './constants'

// 케이스 출처: 구 repo tests/test_repos.py TestDiffApplyTreatWorktreeAsPresent
// (행동만 옮김 -- 코드 복사 아님).

function makeWorktreeDir(scanBase: string, name: string): string {
  const p = path.join(scanBase, name)
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, '.git'), 'gitdir: /some/other/repo/.git/worktrees/foo\n')
  return p
}

describe('diffRepos', () => {
  it('test_diff_does_not_propose_clone_for_existing_worktree_dir', async () => {
    const fixture = makeFixture('reference')
    const scanBase = path.join(fixture.ctx.homeDir, 'repos')
    fs.mkdirSync(scanBase, { recursive: true })
    const wt = makeWorktreeDir(scanBase, 'present-worktree')
    const homeForm = contractHome(fixture.ctx, wt)
    writeCommonLayer(fixture.ctx, REPOS_LAYER, {
      repo: [{ path: homeForm, url: 'git@example.com:x/y.git', branch: 'main' }]
    })

    const d = await diffRepos(fixture.ctx)
    expect(d.toClone).toEqual([])
    expect(d.manualNoUrl).toEqual([])
    fixture.cleanup()
  })

  it('proposes a clone when the manifested path does not exist on disk', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, REPOS_LAYER, {
      repo: [{ path: '~/repos/missing-one', url: 'git@example.com:x/y.git', branch: 'main' }]
    })
    const d = await diffRepos(fixture.ctx)
    expect(d.toClone).toHaveLength(1)
    expect(d.toClone[0].path).toBe('~/repos/missing-one')
    fixture.cleanup()
  })
})
