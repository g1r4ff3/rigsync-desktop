/**
 * git 전송 "배선" — 판단(`syncReference`/`syncFollower`/`getSyncStatus`)은
 * `src/engine/transport/sync.ts`, 여기는 실제 `GitTransportProvider` 연결 +
 * "마지막 동기화 상태" 메모리 보관(스케줄러의 `lastResult` 패턴과 동일)만
 * 한다. manifest write 경로(capture·ignore 토글) 뒤에서 fire-and-forget으로
 * 호출돼도 caller(캡처 IPC 핸들러)를 블로킹하지 않는다 — push 실패는
 * `getLastSyncStatus()`를 통해 상태바에 표면화된다(코디네이터 지시 "표면화,
 * 재시도는 수동 지금 동기화").
 */
import type { RigsyncContext } from '../engine/context'
import {
  getSyncStatus,
  prepareAuthoredPull,
  sweepLiveEditsIfDirty,
  syncAuthoredWrite,
  syncNow
} from '../engine/transport/sync'
import type { GitTransportProvider, SyncStatus } from '../engine/transport/types'

let lastStatus: SyncStatus | null = null

export async function getLastSyncStatus(
  ctx: RigsyncContext,
  provider: GitTransportProvider
): Promise<SyncStatus> {
  // 아직 한 번도 syncNow가 안 돌았으면(예: 앱 막 시작) 부작용 없는 상태 조회로 대체.
  return lastStatus ?? getSyncStatus(ctx, provider)
}

export async function triggerSync(
  ctx: RigsyncContext,
  provider: GitTransportProvider
): Promise<SyncStatus> {
  const status = await syncNow(ctx, provider)
  lastStatus = status
  return status
}

/** manifest 쓰기 핸들러 뒤에서 fire-and-forget으로 부른다 — reference만 대상. */
export function autoSyncAfterWrite(ctx: RigsyncContext, provider: GitTransportProvider): void {
  if (ctx.role !== 'reference') return
  void triggerSync(ctx, provider).catch((err: unknown) => {
    lastStatus = { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  })
}

/**
 * P4(F4/D3-a) 라이브 편집 스윕 — manifest 쓰기 경로(capture·ignore 토글)가
 * **시작되기 전에** 호출한다(ipc.ts `withAutoSync`·toggle 핸들러들). reference에서
 * 작업 트리가 이미 dirty했다면(사용자가 심링크 너머로 직접 편집한 것) 그 dirt를
 * 이번 쓰기 자신의 변경과 섞이기 전에 `live-edit: …` 커밋으로 먼저 분리해
 * push한다 -- 그래야 이번 쓰기 뒤에 `autoSyncAfterWrite`가 만드는 "capture: …"
 * 커밋이 이번 쓰기만 담는다(engine `sweepLiveEditsIfDirty`의 role 가드로
 * follower는 항상 no-op). 드리프트 스케줄러(main/driftCheck.ts)도 같은 함수를
 * 부른다 -- 캡처/토글과 무관하게 시간이 지나면서 쌓인 라이브 편집을 정리하기 위함.
 * `autoSyncAfterWrite`와 같은 fire-and-forget이 아니라 **await로 완료를 기다린다**
 * -- 뒤이은 쓰기가 실제로 깨끗한 트리 위에서 시작돼야 분리가 성립하기 때문이다.
 */
export async function sweepLiveEditsBeforeWrite(
  ctx: RigsyncContext,
  provider: GitTransportProvider
): Promise<void> {
  try {
    const status = await sweepLiveEditsIfDirty(ctx, provider)
    if (status !== null) lastStatus = status
  } catch (err) {
    lastStatus = { kind: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * WS5("창고 모델" 전 머신 저작) — `withAuthoredWrite`(engineWorker.ts)의
 * 사전 단계. role별로 다른 준비를 한다:
 * - reference: 기존 `sweepLiveEditsBeforeWrite`(라이브 편집 분리 커밋,
 *   best-effort — 실패해도 진행을 막지 않는다, 기존 동작 그대로).
 * - 그 외(지금까지 저작 경로가 없던 role): `prepareAuthoredPull` — 이미
 *   dirty하면 진행을 **막는다**(반환값이 `{kind:'error',...}`일 때 호출부가
 *   mutate를 건너뛰어야 한다).
 *
 * 반환값 `null` = 통과. 그 외(error status) = 호출부가 던져서 IPC 에러로
 * 표면화해야 한다(엔진 워커 메시지 루프의 기존 에러 전파 관례).
 */
export async function prepareAuthoredWrite(
  ctx: RigsyncContext,
  provider: GitTransportProvider
): Promise<SyncStatus | null> {
  if (ctx.role === 'reference') {
    await sweepLiveEditsBeforeWrite(ctx, provider)
    return null
  }
  try {
    const status = await prepareAuthoredPull(ctx, provider)
    if (status !== null) lastStatus = status
    return status
  } catch (err) {
    const status: SyncStatus = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err)
    }
    lastStatus = status
    return status
  }
}

/**
 * WS5 — manifest 쓰기 핸들러 뒤에서 fire-and-forget으로 부른다(기존
 * `autoSyncAfterWrite`와 같은 패턴). role을 가리지 않는다는 점이 다르다 —
 * `syncAuthoredWrite`가 role 무관하게 commit(주어진 provenance 메시지)+push한다.
 */
export function autoSyncAfterAuthoredWrite(
  ctx: RigsyncContext,
  provider: GitTransportProvider,
  message: string
): void {
  void syncAuthoredWrite(ctx, provider, message)
    .then((status) => {
      lastStatus = status
    })
    .catch((err: unknown) => {
      lastStatus = { kind: 'error', message: err instanceof Error ? err.message : String(err) }
    })
}

/**
 * WS4("창고 모델" 등록) — `autoSyncAfterAuthoredWrite`의 await 버전. 등록/삭제는
 * 명시적 사용자 액션이라 이 repo가 반복해서 얻은 교훈("됐는지 안 됐는지 알 수
 * 없었다" 재발 방지)에 따라 push 결과를 그 자리에서 응답에 동봉해야 한다
 * (engineWorker.ts `engineRegisterEntry`/`engineUnregisterEntry` 참조). 로직은
 * fire-and-forget인 `autoSyncAfterAuthoredWrite`와 완전히 같고 await 여부와
 * 반환값만 다르다.
 */
export async function awaitAuthoredWrite(
  ctx: RigsyncContext,
  provider: GitTransportProvider,
  message: string
): Promise<SyncStatus> {
  try {
    const status = await syncAuthoredWrite(ctx, provider, message)
    lastStatus = status
    return status
  } catch (err) {
    const status: SyncStatus = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err)
    }
    lastStatus = status
    return status
  }
}
