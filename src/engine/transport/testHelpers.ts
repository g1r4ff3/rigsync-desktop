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
}

const OK: GitCommandResult = { ok: true, output: '' }

export function makeFakeGitTransportProvider(
  state: FakeGitTransportState = {}
): GitTransportProvider {
  return {
    isGitRepo: () => state.isGitRepo ?? false,
    hasRemote: () => state.hasRemote ?? false,
    fetch: () => state.fetchResult ?? OK,
    pullFastForward: () => state.pullResult ?? OK,
    behindCount: () => state.behindCount ?? 0,
    hasUncommittedChanges: () => state.hasUncommittedChanges ?? false,
    changedFiles: () => state.changedFiles ?? [],
    addAllAndCommit: () => state.commitResult ?? OK,
    push: () => state.pushResult ?? OK,
    cloneManifest: () => state.cloneResult ?? OK
  }
}
