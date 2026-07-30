/**
 * manifest repo의 git 전송 계층 — FORWARD.md §2 "git은 보이지 않는다":
 * commit/push/pull은 엔진이 수행하고 UI는 상태(동기화됨/뒤처짐/로컬 전용/
 * 오류)만 본다. manifest dir이 git repo가 아니거나 원격이 없으면 **로컬
 * 모드로 조용히 정상 동작**한다(에러 아님).
 *
 * perf 3라운드(providers 비동기화): 전 메서드가 실제 git 프로세스를 spawn하므로
 * `MaybePromise<T>`(`src/engine/async.ts`)를 돌려준다. `addAllAndCommit`처럼
 * 순차 의존(add→commit)이 있는 메서드는 실제 구현 내부에서 await 체인을
 * 유지한다 — 이 인터페이스 변경 자체가 순서를 바꾸지 않는다.
 */
import type { MaybePromise } from '../async'

export interface GitCommandResult {
  readonly ok: boolean
  readonly output: string
}

/** `git status --porcelain` 한 줄 — XY 상태 코드 원문 + 경로. */
export interface GitChangedFile {
  /** porcelain XY 코드 그대로(예: ` M`, `??`, `A `, `D `) -- 트림하지 않는다(의미 있는 공백). */
  readonly status: string
  readonly path: string
}

/**
 * 실제 git 호출 인터페이스 — P2a 결정 ⑥과 동일한 원칙(provider 뒤 시스템 격리).
 * 단 이 provider는 실제 구현(`providers/linux/gitTransport.ts`)을 fake가 아닌
 * **로컬 temp 디렉터리의 진짜 git repo**로 테스트한다(코디네이터 지시 — git은
 * 로컬 실행이라 안전).
 */
export interface GitTransportProvider {
  isGitRepo(dir: string): MaybePromise<boolean>
  /** `git remote`가 하나라도 있는지. */
  hasRemote(dir: string): MaybePromise<boolean>
  fetch(dir: string): MaybePromise<GitCommandResult>
  /**
   * fast-forward만 허용하는 pull. 비FF·충돌이면 **어떤 자동 해결도 시도하지
   * 않고** `ok:false`로 보고한다(호출자가 "수동 해결 필요"로 표면화).
   */
  pullFastForward(dir: string): MaybePromise<GitCommandResult>
  /**
   * WS5("창고 모델" 전 머신 저작): `git pull --rebase`. 로컬 커밋이 이미
   * 있는 상태에서의 push 거부 재시도 전용 — 그 상황에선 정의상 fast-forward가
   * 불가능하다(로컬이 origin의 조상이 아니라 갈라진 상태이므로).
   * 실패하면 **best-effort로 `git rebase --abort`를 시도한 뒤** `ok:false`를
   * 반환한다(작업 트리를 rebase 중간 상태로 남기지 않는다 — abort 자체의
   * 성공 여부는 반환값에 반영하지 않는다, 원래 실패 원문을 그대로 표면화).
   */
  pullRebase(dir: string): MaybePromise<GitCommandResult>
  /** `fetch()` 이후 기준 — origin의 upstream 대비 몇 커밋 뒤처졌는지. */
  behindCount(dir: string): MaybePromise<number>
  hasUncommittedChanges(dir: string): MaybePromise<boolean>
  /**
   * `git status --porcelain` 상당의 구조화된 변경 파일 목록 — P3(F3) Doctor
   * "manifest dirty" 검사가 역할별 안내(follower: 경고, reference: 정보)에
   * 파일 목록을 실어 보내기 위해 `hasUncommittedChanges`(boolean)보다 세밀한
   * 정보가 필요해 추가한다. 순서는 porcelain 출력 순서 그대로(경로순 정렬은
   * 호출자 책임 -- 이 provider는 git 그대로만 옮긴다).
   */
  changedFiles(dir: string): MaybePromise<readonly GitChangedFile[]>
  addAllAndCommit(dir: string, message: string): MaybePromise<GitCommandResult>
  push(dir: string): MaybePromise<GitCommandResult>
  /**
   * `git clone <url> <targetDir>` — 온보딩 "저장소에서 클론"(follower의 정상
   * 진입 경로)과 Settings의 복구용 클론이 공유하는 진입점. `targetDir`은
   * 아직 없거나 있어도 비어 있어야 한다(git clone 자체의 제약 — 실패하면
   * `ok:false`에 git의 원문 stderr가 담긴다. 분류는 `transport/clone.ts`가
   * 이 원문 텍스트를 해석해서 한다).
   */
  cloneManifest(url: string, targetDir: string): MaybePromise<GitCommandResult>
}

export type SyncStatus =
  | { readonly kind: 'local-only' }
  | { readonly kind: 'synced' }
  | { readonly kind: 'behind'; readonly behindBy: number }
  | { readonly kind: 'error'; readonly message: string }
