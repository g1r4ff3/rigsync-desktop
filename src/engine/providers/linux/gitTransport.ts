/**
 * 실제 git 전송 — `GitTransportProvider`의 구현. git은 플랫폼 무관 CLI라
 * "linux" 전용은 아니지만, 다른 provider들과 위치를 맞춘다(v1은 어차피
 * Linux provider만 조립하므로 `providers/linux/index.ts`에서 함께 노출).
 */
import type { GitChangedFile, GitCommandResult, GitTransportProvider } from '../../transport/types'
import { run } from './exec'

async function git(
  dir: string,
  args: string[],
  timeoutMs = 30_000
): Promise<{ code: number; text: string }> {
  const result = await run(['git', '-C', dir, ...args], timeoutMs)
  return { code: result.code, text: result.stdout + result.stderr }
}

export class LinuxGitTransportProvider implements GitTransportProvider {
  async isGitRepo(dir: string): Promise<boolean> {
    return (await git(dir, ['rev-parse', '--is-inside-work-tree'])).code === 0
  }

  async hasRemote(dir: string): Promise<boolean> {
    const result = await git(dir, ['remote'])
    return result.code === 0 && result.text.trim().length > 0
  }

  async fetch(dir: string): Promise<GitCommandResult> {
    const result = await git(dir, ['fetch', '--all'], 60_000)
    return { ok: result.code === 0, output: result.text }
  }

  async pullFastForward(dir: string): Promise<GitCommandResult> {
    const result = await git(dir, ['pull', '--ff-only'], 60_000)
    return { ok: result.code === 0, output: result.text }
  }

  async behindCount(dir: string): Promise<number> {
    const result = await git(dir, ['rev-list', '--count', 'HEAD..@{u}'])
    if (result.code !== 0) return 0
    const n = Number.parseInt(result.text.trim(), 10)
    return Number.isFinite(n) ? n : 0
  }

  async hasUncommittedChanges(dir: string): Promise<boolean> {
    const result = await git(dir, ['status', '--porcelain'])
    return result.code === 0 && result.text.trim().length > 0
  }

  async changedFiles(dir: string): Promise<readonly GitChangedFile[]> {
    const result = await git(dir, ['status', '--porcelain'])
    if (result.code !== 0) return []
    return result.text
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const status = line.slice(0, 2)
        let rest = line.slice(3)
        // rename/copy 라인은 "orig -> new" 형태 -- 새 경로만 취한다.
        const arrow = rest.indexOf(' -> ')
        if (arrow !== -1) rest = rest.slice(arrow + 4)
        return { status, path: rest }
      })
  }

  async addAllAndCommit(dir: string, message: string): Promise<GitCommandResult> {
    // 순차 의존 -- add가 성공해야 commit이 의미 있다(순서 파괴 금지).
    const add = await git(dir, ['add', '-A'])
    if (add.code !== 0) return { ok: false, output: add.text }
    const commit = await git(dir, ['commit', '-m', message])
    return { ok: commit.code === 0, output: commit.text }
  }

  async push(dir: string): Promise<GitCommandResult> {
    const result = await git(dir, ['push'], 60_000)
    return { ok: result.code === 0, output: result.text }
  }

  async cloneManifest(url: string, targetDir: string): Promise<GitCommandResult> {
    // `targetDir`이 아직 없어 `git -C targetDir ...`(다른 메서드들의 공용
    // helper)를 쓸 수 없다 -- clone 자체가 그 디렉터리를 만드는 명령이라
    // run()을 직접 호출한다.
    const result = await run(['git', 'clone', url, targetDir], 120_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }
}
