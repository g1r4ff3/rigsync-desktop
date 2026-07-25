import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { readCommonLayer } from '../../manifest'
import { contractHome } from '../../paths'
import { captureRepos, FollowerReposCaptureBlockedError, isGitWorktree } from './capture'
import { REPOS_LAYER } from './constants'
import { makeFakeGitProvider } from './testHelpers'
import type { ReposManifest } from './types'

// 케이스 출처: 구 repo tests/test_repos.py TestCaptureSkipsWorktrees
// (2케이스, 행동만 옮김 -- 코드 복사 아님). git worktree(.git이 파일)는 capture가
// git 플럼빙을 만지기 전에 걸러야 하므로 fake `.git` 파일/디렉터리로 충분하다
// (실제 git init 불필요).

function makePlainRepo(scanBase: string, name: string): string {
  const p = path.join(scanBase, name)
  fs.mkdirSync(path.join(p, '.git'), { recursive: true })
  return p
}

function makeWorktreeDir(scanBase: string, name: string): string {
  const p = path.join(scanBase, name)
  fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, '.git'), 'gitdir: /some/other/repo/.git/worktrees/foo\n')
  return p
}

describe('captureRepos', () => {
  it('rejects capture on a follower machine', async () => {
    const fixture = makeFixture('follower')
    await expect(
      captureRepos(fixture.ctx, makeFakeGitProvider(), { dryRun: false })
    ).rejects.toThrow(FollowerReposCaptureBlockedError)
    fixture.cleanup()
  })

  it('test_worktree_skipped_with_note_and_not_added_to_manifest', async () => {
    const scanBase = fs.mkdtempSync(path.join(os.tmpdir(), 'repos-scan-'))
    const fixture = makeFixture('reference', { settings: { repoScanDirs: [scanBase] } })
    const plain = makePlainRepo(scanBase, 'plain-clone')
    const wt = makeWorktreeDir(scanBase, 'a-worktree')

    const report = await captureRepos(fixture.ctx, makeFakeGitProvider(), { dryRun: false })

    expect(
      report.notes.some((n) => n.includes('skipped (worktree)') && n.includes('a-worktree'))
    ).toBe(true)

    const manifest = readCommonLayer(fixture.ctx, REPOS_LAYER) as ReposManifest
    const paths = (manifest.repo ?? []).map((r) => r.path)
    expect(paths).toContain(contractHome(fixture.ctx, plain))
    expect(paths).not.toContain(contractHome(fixture.ctx, wt))
    fixture.cleanup()
  })

  it('test_is_git_worktree_helper_distinguishes_file_vs_dir_git', () => {
    const scanBase = fs.mkdtempSync(path.join(os.tmpdir(), 'repos-scan-'))
    const plain = makePlainRepo(scanBase, 'plain-clone-2')
    const wt = makeWorktreeDir(scanBase, 'worktree-2')
    expect(isGitWorktree(plain)).toBe(false)
    expect(isGitWorktree(wt)).toBe(true)
    fs.rmSync(scanBase, { recursive: true, force: true })
  })
})
