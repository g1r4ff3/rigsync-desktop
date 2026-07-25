import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { contractHome } from '../../paths'
import { diffRepos } from './diff'
import { planRepos } from './plan'
import { REPOS_LAYER } from './constants'
import { makeFakeGitProvider } from './testHelpers'

// 케이스 출처: 구 repo tests/test_repos.py
// test_apply_plan_has_no_clone_action_for_existing_worktree_dir (행동만 옮김).

function makeWorktreeDir(scanBase: string, name: string): string {
  const p = path.join(scanBase, name)
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, '.git'), 'gitdir: /some/other/repo/.git/worktrees/foo\n')
  return p
}

describe('planRepos', () => {
  it('test_apply_plan_has_no_clone_action_for_existing_worktree_dir', async () => {
    const fixture = makeFixture('reference')
    const scanBase = path.join(fixture.ctx.homeDir, 'repos')
    fs.mkdirSync(scanBase, { recursive: true })
    const wt = makeWorktreeDir(scanBase, 'present-worktree-2')
    const homeForm = contractHome(fixture.ctx, wt)
    writeCommonLayer(fixture.ctx, REPOS_LAYER, {
      repo: [{ path: homeForm, url: 'git@example.com:x/y.git', branch: 'main' }]
    })

    const diff = await diffRepos(fixture.ctx)
    const plan = planRepos(fixture.ctx, makeFakeGitProvider(), diff)
    expect(plan).toEqual([])
    fixture.cleanup()
  })

  it('a clone action is never sudo, and run() clones via the provider into the parent dir', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, REPOS_LAYER, {
      repo: [{ path: '~/repos/new-one', url: 'git@example.com:x/y.git', branch: 'main' }]
    })
    const diff = await diffRepos(fixture.ctx)
    const provider = makeFakeGitProvider()
    const plan = planRepos(fixture.ctx, provider, diff)
    expect(plan).toHaveLength(1)
    expect(plan[0].privileged).toBeFalsy()
    for (const cmd of plan[0].commands) expect(cmd.trim().startsWith('sudo')).toBe(false)

    const result = await plan[0].run()
    expect(result.ok).toBe(true)
    expect(provider.cloneCalls).toEqual([
      { url: 'git@example.com:x/y.git', dest: path.join(fixture.ctx.homeDir, 'repos', 'new-one') }
    ])
    fixture.cleanup()
  })
})
