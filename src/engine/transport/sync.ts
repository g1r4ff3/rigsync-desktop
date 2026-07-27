/**
 * git 전송 오케스트레이션 — 구 CLI의 "reference=저작(commit+push), follower=
 * 수신 전용(pull)" 단방향 배포 계약(FORWARD.md §1-②)을 그대로 옮긴다. role
 * 가드는 이미 각 capability의 capture 함수가 하므로, 여기서는 "이 머신이
 * reference/follower일 때 동기화를 어떻게 하는가"만 판단한다.
 */
import type { RigsyncContext } from '../context'
import { scanManifestForSecrets } from '../safety/manifestScan'
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

/**
 * ⑤ push 직전 재검사(이중 안전망) — 각 capability의 capture 관문을 어떤 경로로든
 * 우회해 manifest에 비밀이 실렸을 가능성(수동 편집, 관문 도입 전 캡처분 등)에
 * 대비해 **push 바로 직전**에 manifest 전체를 다시 스캔한다. 커밋까지는 허용한다
 * (로컬이라 회수 가능 — 안 하면 다음 capture까지 변경분이 통째로 묶여버린다)
 * 지만, **push는 여기서 막는다**(원격 이력에 박히면 회수가 어렵다 -- 코디네이터
 * 지시). 새 SyncStatus kind를 만들지 않고 기존 'error' kind를 재사용한다 --
 * 렌더러의 에러 상태 렌더링(상태바 메시지)이 이미 "무엇을 해야 하는지"를
 * 그대로 보여주므로 렌더러 쪽 변경 없이 Explanability contract의 State 층을
 * 만족한다. syncReference와 P4(F4/D3-a) `sweepLiveEditsIfDirty` 둘 다 이 게이트를
 * 거친다 -- push 경로가 하나뿐이라 우회할 수 없다.
 */
async function pushAfterSecretScan(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  provider: GitTransportProvider
): Promise<SyncStatus> {
  const scan = scanManifestForSecrets(ctx)
  if (scan.blocked) {
    const paths = [...new Set(scan.findings.map((f) => f.path))]
    return {
      kind: 'error',
      message:
        `push 중단 -- manifest에 비밀로 의심되는 값이 있습니다 (${scan.findings.length}건, ` +
        `경로 ${paths.length}개: ${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ' 등' : ''}). ` +
        'Doctor의 "Secret scan"에서 확인 후 common/secret-allowlist.toml에 등록하거나 ' +
        '해당 파일을 제외한 뒤 다시 캡처하세요.'
    }
  }

  const push = provider.push(ctx.manifestDir)
  if (!push.ok)
    return { kind: 'error', message: push.output || 'push 실패 -- "지금 동기화"로 재시도하세요' }
  return getSyncStatus(ctx, provider)
}

/**
 * reference: 미커밋 변경이 있으면 커밋(`capture: <machineId> <ISO date>`) 후 push.
 */
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

  return pushAfterSecretScan(ctx, provider)
}

/**
 * P4(F4/D3-a) 라이브 편집 스윕 커밋 — F4 병인: reference에서 심링크 너머로
 * dotfiles를 직접 편집하면 store 파일은 즉시 바뀌지만, commit+push는 **다음
 * 아무 capture/토글**이 `syncReference`(위)의 addAllAndCommit을 돌릴 때
 * 우연히 실린다 — 커밋 메시지("capture: …")와 실제 내용이 어긋나고 전파가
 * 비결정적이다.
 *
 * 해소: capture/토글 등 쓰기 경로가 **시작되기 전에**(main/gitSync.ts의
 * `sweepLiveEditsBeforeWrite`가 이 함수를 그 지점에서 호출한다) 작업 트리가
 * 이미 dirty했다면, 그 dirt를 이번 쓰기와 섞이기 전에 별도의
 * `live-edit: dotfiles 라이브 편집` 커밋으로 먼저 분리해 push한다. 그러면
 * 뒤이어 실제 쓰기가 일어난 뒤 `syncReference`가 만드는 "capture: …" 커밋은
 * 그 쓰기 자신의 diff만 담게 된다. 드리프트 스케줄러(main/driftCheck.ts)도
 * 캡처/토글과 무관하게 주기적으로 이 함수를 불러 같은 정리를 한다.
 *
 * follower는 저작하지 않는다(불변식 ⑦) -- follower의 dirty는 이 함수가 아니라
 * doctor/manifestDirtyCheck(P3)의 경고 영역이다. 호출자가 role을 가리지 않고
 * 불러도 안전하도록 역할 가드를 이 함수 안에 둔다(호출부 실수에 대한 방어선).
 */
export const LIVE_EDIT_COMMIT_MESSAGE = 'live-edit: dotfiles 라이브 편집'

export async function sweepLiveEditsIfDirty(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'role'>,
  provider: GitTransportProvider
): Promise<SyncStatus | null> {
  if (ctx.role !== 'reference') return null
  if (!provider.isGitRepo(ctx.manifestDir) || !provider.hasRemote(ctx.manifestDir)) return null
  if (!provider.hasUncommittedChanges(ctx.manifestDir)) return null

  const commit = provider.addAllAndCommit(ctx.manifestDir, LIVE_EDIT_COMMIT_MESSAGE)
  if (!commit.ok) return { kind: 'error', message: commit.output || '커밋 실패' }

  return pushAfterSecretScan(ctx, provider)
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
