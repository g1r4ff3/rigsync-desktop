/**
 * 실제 git 전송 — `GitTransportProvider`의 구현. git은 플랫폼 무관 CLI라
 * "linux" 전용은 아니지만, 다른 provider들과 위치를 맞춘다(v1은 어차피
 * Linux provider만 조립하므로 `providers/linux/index.ts`에서 함께 노출).
 */
import type { GitCommandResult, GitTransportProvider } from '../../transport/types'
import { run } from './exec'

function git(dir: string, args: string[], timeoutMs = 30_000): { code: number; text: string } {
  const result = run(['git', '-C', dir, ...args], timeoutMs)
  return { code: result.code, text: result.stdout + result.stderr }
}

export class LinuxGitTransportProvider implements GitTransportProvider {
  isGitRepo(dir: string): boolean {
    return git(dir, ['rev-parse', '--is-inside-work-tree']).code === 0
  }

  hasRemote(dir: string): boolean {
    const result = git(dir, ['remote'])
    return result.code === 0 && result.text.trim().length > 0
  }

  fetch(dir: string): GitCommandResult {
    const result = git(dir, ['fetch', '--all'], 60_000)
    return { ok: result.code === 0, output: result.text }
  }

  pullFastForward(dir: string): GitCommandResult {
    const result = git(dir, ['pull', '--ff-only'], 60_000)
    return { ok: result.code === 0, output: result.text }
  }

  behindCount(dir: string): number {
    const result = git(dir, ['rev-list', '--count', 'HEAD..@{u}'])
    if (result.code !== 0) return 0
    const n = Number.parseInt(result.text.trim(), 10)
    return Number.isFinite(n) ? n : 0
  }

  hasUncommittedChanges(dir: string): boolean {
    const result = git(dir, ['status', '--porcelain'])
    return result.code === 0 && result.text.trim().length > 0
  }

  addAllAndCommit(dir: string, message: string): GitCommandResult {
    const add = git(dir, ['add', '-A'])
    if (add.code !== 0) return { ok: false, output: add.text }
    const commit = git(dir, ['commit', '-m', message])
    return { ok: commit.code === 0, output: commit.text }
  }

  push(dir: string): GitCommandResult {
    const result = git(dir, ['push'], 60_000)
    return { ok: result.code === 0, output: result.text }
  }

  cloneManifest(url: string, targetDir: string): GitCommandResult {
    // `targetDir`이 아직 없어 `git -C targetDir ...`(다른 메서드들의 공용
    // helper)를 쓸 수 없다 -- clone 자체가 그 디렉터리를 만드는 명령이라
    // run()을 직접 호출한다.
    const result = run(['git', 'clone', url, targetDir], 120_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }
}
