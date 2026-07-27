/**
 * P2c 결정 ②: snap은 동기화 plan/apply에서 제외한다(정책 §7 비목표 — "Ubuntu
 * 기본 탑재분 외엔 관리하지 않는다"). `planSnap`은 여전히 export되지만(구
 * 행동 보존 + 향후 재검토 대비) 여기서는 더 이상 호출하지 않는다 — snap의
 * capture/diff는 INV-1 중복 검출 조회용으로만 남는다.
 */
import type { RigsyncContext } from '../../context'
import type { PlanAction } from '../../plan'
import { planApt } from './apt'
import { planFlatpak } from './flatpak'
import type { PackageProviders } from './providerTypes'
import type { PackagesDiffReport } from './types'

export async function planPackages(
  ctx: RigsyncContext,
  providers: PackageProviders,
  diff: PackagesDiffReport,
  runTs: string
): Promise<PlanAction[]> {
  // 순차 유지 -- 원래도 순차 평가였다(병렬화는 상위 diff 단계에서만, 이
  // 라운드에서 새 병렬화를 발명하지 않는다는 perf 3라운드 원칙).
  const apt = await planApt(ctx, providers.apt, diff.apt)
  const flatpak = await planFlatpak(ctx, providers.flatpak, diff.flatpak, runTs)
  return [...apt, ...flatpak]
}
