import type { GitCommandResult, GitProvider } from './providerTypes'

export interface FakeGitState {
  /** absPath -> remote url. */
  remotes?: Record<string, string>
  /** absPath -> branch. */
  branches?: Record<string, string>
  cloneShouldFail?: boolean
}

export interface FakeGitProvider extends GitProvider {
  readonly cloneCalls: Array<{ url: string; dest: string }>
}

export function makeFakeGitProvider(state: FakeGitState = {}): FakeGitProvider {
  const cloneCalls: Array<{ url: string; dest: string }> = []
  return {
    remoteUrl: (absPath: string) => state.remotes?.[absPath] ?? '',
    branch: (absPath: string) => state.branches?.[absPath] ?? 'main',
    clone: (url: string, dest: string): GitCommandResult => {
      cloneCalls.push({ url, dest })
      return state.cloneShouldFail
        ? { ok: false, output: 'clone failed' }
        : { ok: true, output: '' }
    },
    cloneCalls
  }
}
