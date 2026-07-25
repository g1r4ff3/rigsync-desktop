/**
 * packages capture 오케스트레이터 — apt/snap/flatpak 세 provider를 순서대로
 * capture하고 결과를 하나로 묶는다. dotfiles의 role guard와 동일한 이유로
 * follower 머신에서는 거부한다 (불변식 ⑦).
 */
import type { RigsyncContext } from '../../context'
import { captureApt } from './apt'
import { captureFlatpak } from './flatpak'
import { captureSnap } from './snap'
import type { PackageProviders } from './providerTypes'
import type { PackagesCaptureReport } from './types'

export class FollowerPackagesCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerPackagesCaptureBlockedError'
  }
}

export interface CapturePackagesOptions {
  readonly dryRun: boolean
}

export async function capturePackages(
  ctx: RigsyncContext,
  providers: PackageProviders,
  options: CapturePackagesOptions
): Promise<PackagesCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerPackagesCaptureBlockedError()
  }

  // 순차 실행 -- 셋 다 같은 packages.toml을 read-modify-write하므로 동시
  // 실행(Promise.all)은 한쪽의 쓰기를 다른 쪽이 stale 상태로 덮어쓸 위험이 있다.
  const apt = await captureApt(ctx, providers.apt, options)
  const snap = await captureSnap(ctx, providers.snap, options)
  const flatpak = await captureFlatpak(ctx, providers.flatpak, options)

  return { capability: 'packages', apt, snap, flatpak }
}
