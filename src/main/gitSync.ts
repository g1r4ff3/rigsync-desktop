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
import { getSyncStatus, syncNow } from '../engine/transport/sync'
import type { GitTransportProvider, SyncStatus } from '../engine/transport/types'

let lastStatus: SyncStatus | null = null

export function getLastSyncStatus(ctx: RigsyncContext, provider: GitTransportProvider): SyncStatus {
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
