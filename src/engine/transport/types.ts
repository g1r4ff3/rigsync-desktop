/**
 * manifest repo의 git 전송 계층 — FORWARD.md §2 "git은 보이지 않는다":
 * commit/push/pull은 엔진이 수행하고 UI는 상태(동기화됨/뒤처짐/로컬 전용/
 * 오류)만 본다. manifest dir이 git repo가 아니거나 원격이 없으면 **로컬
 * 모드로 조용히 정상 동작**한다(에러 아님).
 */

export interface GitCommandResult {
  readonly ok: boolean
  readonly output: string
}

/**
 * 실제 git 호출 인터페이스 — P2a 결정 ⑥과 동일한 원칙(provider 뒤 시스템 격리).
 * 단 이 provider는 실제 구현(`providers/linux/gitTransport.ts`)을 fake가 아닌
 * **로컬 temp 디렉터리의 진짜 git repo**로 테스트한다(코디네이터 지시 — git은
 * 로컬 실행이라 안전).
 */
export interface GitTransportProvider {
  isGitRepo(dir: string): boolean
  /** `git remote`가 하나라도 있는지. */
  hasRemote(dir: string): boolean
  fetch(dir: string): GitCommandResult
  /**
   * fast-forward만 허용하는 pull. 비FF·충돌이면 **어떤 자동 해결도 시도하지
   * 않고** `ok:false`로 보고한다(호출자가 "수동 해결 필요"로 표면화).
   */
  pullFastForward(dir: string): GitCommandResult
  /** `fetch()` 이후 기준 — origin의 upstream 대비 몇 커밋 뒤처졌는지. */
  behindCount(dir: string): number
  hasUncommittedChanges(dir: string): boolean
  addAllAndCommit(dir: string, message: string): GitCommandResult
  push(dir: string): GitCommandResult
}

export type SyncStatus =
  | { readonly kind: 'local-only' }
  | { readonly kind: 'synced' }
  | { readonly kind: 'behind'; readonly behindBy: number }
  | { readonly kind: 'error'; readonly message: string }
