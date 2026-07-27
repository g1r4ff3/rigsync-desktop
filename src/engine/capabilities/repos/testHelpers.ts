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
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증).
    remoteUrl: (absPath: string) => Promise.resolve(state.remotes?.[absPath] ?? ''),
    branch: (absPath: string) => Promise.resolve(state.branches?.[absPath] ?? 'main'),
    clone: (url: string, dest: string): Promise<GitCommandResult> => {
      cloneCalls.push({ url, dest })
      return Promise.resolve(
        state.cloneShouldFail ? { ok: false, output: 'clone failed' } : { ok: true, output: '' }
      )
    },
    cloneCalls
  }
}
