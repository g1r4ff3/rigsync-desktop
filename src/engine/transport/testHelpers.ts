import type { GitChangedFile, GitCommandResult, GitTransportProvider } from './types'

/**
 * fake GitTransportProvider -- doctor/report.test.ts, onboarding 클론 유닛
 * 테스트 등 실제 git 실행 없이 상태만 필요한 곳이 공유한다. sync.test.ts는
 * 의도적으로 이 fake를 쓰지 않고 로컬 bare repo(진짜 git)로 검증한다(git은
 * 로컬 실행이라 안전 -- 코디네이터 지시, gitTransport.ts 주석 참조).
 */
export interface FakeGitTransportState {
  readonly isGitRepo?: boolean
  readonly hasRemote?: boolean
  readonly behindCount?: number
  readonly hasUncommittedChanges?: boolean
  readonly changedFiles?: readonly GitChangedFile[]
  readonly cloneResult?: GitCommandResult
  readonly fetchResult?: GitCommandResult
  readonly pushResult?: GitCommandResult
  readonly pullResult?: GitCommandResult
  readonly commitResult?: GitCommandResult
  /** WS5: `git pull --rebase` fake 결과. */
  readonly rebaseResult?: GitCommandResult
}

const OK: GitCommandResult = { ok: true, output: '' }

export function makeFakeGitTransportProvider(
  state: FakeGitTransportState = {}
): GitTransportProvider {
  return {
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증) -- GitTransportProvider는 전 메서드가
    // MaybePromise(types.ts).
    isGitRepo: () => Promise.resolve(state.isGitRepo ?? false),
    hasRemote: () => Promise.resolve(state.hasRemote ?? false),
    fetch: () => Promise.resolve(state.fetchResult ?? OK),
    pullFastForward: () => Promise.resolve(state.pullResult ?? OK),
    pullRebase: () => Promise.resolve(state.rebaseResult ?? OK),
    behindCount: () => Promise.resolve(state.behindCount ?? 0),
    hasUncommittedChanges: () => Promise.resolve(state.hasUncommittedChanges ?? false),
    changedFiles: () => Promise.resolve(state.changedFiles ?? []),
    addAllAndCommit: () => Promise.resolve(state.commitResult ?? OK),
    push: () => Promise.resolve(state.pushResult ?? OK),
    cloneManifest: () => Promise.resolve(state.cloneResult ?? OK)
  }
}
