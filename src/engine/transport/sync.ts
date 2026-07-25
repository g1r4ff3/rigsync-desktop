/**
 * git 전송 오케스트레이션 — 구 CLI의 "reference=저작(commit+push), follower=
 * 수신 전용(pull)" 단방향 배포 계약(FORWARD.md §1-②)을 그대로 옮긴다. role
 * 가드는 이미 각 capability의 capture 함수가 하므로, 여기서는 "이 머신이
 * reference/follower일 때 동기화를 어떻게 하는가"만 판단한다.
 */
import type { RigsyncContext } from '../context'
import type { GitTransportProvider, SyncStatus } from './types'

/** 부작용 없는 상태 조회 — behindCount는 마지막 fetch 기준이라 갱신하려면 fetch를 먼저 해야 한다. */
export function getSyncStatus(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  provider: GitTransportProvider
): SyncStatus {
  if (!provider.isGitRepo(ctx.manifestDir) || !provider.hasRemote(ctx.manifestDir)) {
    return { kind: 'local-only' }
  }
  const behindBy = provider.behindCount(ctx.manifestDir)
  return behindBy > 0 ? { kind: 'behind', behindBy } : { kind: 'synced' }
}

/** reference: 미커밋 변경이 있으면 커밋(`capture: <machineId> <ISO date>`) 후 push. */
export async function syncReference(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  provider: GitTransportProvider
): Promise<SyncStatus> {
  if (!provider.isGitRepo(ctx.manifestDir) || !provider.hasRemote(ctx.manifestDir)) {
    return { kind: 'local-only' }
  }
  if (provider.hasUncommittedChanges(ctx.manifestDir)) {
    const message = `capture: ${ctx.machineId} ${new Date().toISOString().slice(0, 10)}`
    const commit = provider.addAllAndCommit(ctx.manifestDir, message)
    if (!commit.ok) return { kind: 'error', message: commit.output || '커밋 실패' }
  }
  const push = provider.push(ctx.manifestDir)
  if (!push.ok)
    return { kind: 'error', message: push.output || 'push 실패 -- "지금 동기화"로 재시도하세요' }
  return getSyncStatus(ctx, provider)
}

/** follower: fetch 후 뒤처졌으면 fast-forward pull만. 비FF/충돌은 자동 해결 절대 금지. */
export async function syncFollower(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  provider: GitTransportProvider
): Promise<SyncStatus> {
  if (!provider.isGitRepo(ctx.manifestDir) || !provider.hasRemote(ctx.manifestDir)) {
    return { kind: 'local-only' }
  }
  const fetch = provider.fetch(ctx.manifestDir)
  if (!fetch.ok) return { kind: 'error', message: fetch.output || 'fetch 실패' }

  const behindBy = provider.behindCount(ctx.manifestDir)
  if (behindBy > 0) {
    const pull = provider.pullFastForward(ctx.manifestDir)
    if (!pull.ok) {
      return {
        kind: 'error',
        message: `수동 해결 필요 -- fast-forward 불가(비-FF 또는 충돌): ${pull.output}`
      }
    }
  }
  return getSyncStatus(ctx, provider)
}

/** role에 따라 syncReference/syncFollower로 위임한다 — main IPC·스케줄러가 부르는 단일 진입점. */
export async function syncNow(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId' | 'role'>,
  provider: GitTransportProvider
): Promise<SyncStatus> {
  return ctx.role === 'reference' ? syncReference(ctx, provider) : syncFollower(ctx, provider)
}
