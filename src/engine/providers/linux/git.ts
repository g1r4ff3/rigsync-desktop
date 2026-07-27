/**
 * 실제 git 조회+clone — `GitProvider`의 Linux 구현. 구 repo
 * `probe_git_remote_url`/`probe_git_branch`(rigsync.py:625-638) 행동 이식.
 */
import type { GitCommandResult, GitProvider } from '../../capabilities/repos/providerTypes'
import { run } from './exec'

export class LinuxGitProvider implements GitProvider {
  async remoteUrl(absPath: string): Promise<string> {
    const result = await run(['git', '-C', absPath, 'config', '--get', 'remote.origin.url'])
    return result.code === 0 ? result.stdout.trim() : ''
  }

  async branch(absPath: string): Promise<string> {
    const result = await run(['git', '-C', absPath, 'symbolic-ref', '--short', 'HEAD'])
    return result.code === 0 ? result.stdout.trim() : ''
  }

  async clone(url: string, dest: string): Promise<GitCommandResult> {
    const result = await run(['git', 'clone', url, dest], 600_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }
}
