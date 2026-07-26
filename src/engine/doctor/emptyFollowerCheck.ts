/**
 * "빈 follower" doctor 체크 -- 실사용 결함 수정: follower를 온보딩하면서
 * manifest 저장소가 원격과 연결되지 않은 빈 로컬 디렉터리로 만들어지면,
 * 앱이 그 상태를 아무 경고 없이 "정상"(로컬 전용)으로 보여줬다. follower의
 * 정상 경로는 기준(reference) 저장소를 클론해 받는 것이라, 이 조합
 * (follower + 선언 거의 없음 또는 원격 없음)은 사실상 항상 사고다.
 *
 * role=reference의 빈 manifest는 반대로 **정상**이다(첫 capture 전이라
 * 당연히 비어 있다) -- 그래서 이 체크는 `applicable=role==='follower'`일
 * 때만 판정하고, reference에선 그냥 정보성 필드만 채워 반환한다.
 */
import type { RigsyncContext } from '../context'
import type { GitTransportProvider } from '../transport/types'
import { countManifestDeclarations } from './manifestSummary'

export interface EmptyFollowerCheckResult {
  /** role === 'follower'일 때만 이 체크가 의미를 가진다. */
  readonly applicable: boolean
  readonly declarationsTotal: number
  readonly hasRemote: boolean
  /** applicable && (declarationsTotal===0 || !hasRemote)일 때만 채워진다. */
  readonly warning?: string
}

export function checkEmptyFollower(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId' | 'profile' | 'role'>,
  gitProvider: Pick<GitTransportProvider, 'isGitRepo' | 'hasRemote'>
): EmptyFollowerCheckResult {
  const applicable = ctx.role === 'follower'
  const declarationsTotal = countManifestDeclarations(ctx)
  const hasRemote = gitProvider.isGitRepo(ctx.manifestDir) && gitProvider.hasRemote(ctx.manifestDir)

  if (!applicable || (declarationsTotal > 0 && hasRemote)) {
    return { applicable, declarationsTotal, hasRemote }
  }

  const reasons: string[] = []
  if (declarationsTotal === 0)
    reasons.push(`manifest에 선언된 항목이 없습니다(${declarationsTotal}건)`)
  if (!hasRemote) reasons.push('원격 저장소가 연결돼 있지 않습니다')

  return {
    applicable,
    declarationsTotal,
    hasRemote,
    warning:
      `이 머신은 follower인데 ${reasons.join(', ')}. ` +
      'follower의 정상 경로는 기준(reference) 저장소를 클론해 받는 것입니다 -- ' +
      '기준 저장소를 클론했는지 확인하세요: Settings에서 manifest 경로를 확인하거나, ' +
      '온보딩의 "저장소에서 클론"으로 다시 연결하세요.'
  }
}
