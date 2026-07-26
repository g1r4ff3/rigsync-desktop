/**
 * 항목 삭제(uninstall) 오케스트레이터 — 안전 불변식 5(2026-07-26 개정)의
 * 진입점. 여러 capability에 걸친 삭제 요청(단건이든 일괄이든 동일 경로 —
 * 단건은 그냥 요청 배열의 길이가 1인 경우)을 capability별로 묶어 각
 * `planXUninstall`에 위임하고, 결과(액션·제외 사유·apt 의존성 경고)를
 * 한 shape로 합친다.
 *
 * capability별로 실제 삭제 방식이 갈리므로(apt는 한 번의 명령으로 합치고,
 * 나머지는 항목별 액션 — 코디네이터 지시) 이 파일 자체는 라우팅만 하고
 * "무엇을 어떻게 지울지"는 각 capability 디렉터리(`dotfiles/plan.ts`,
 * `binaries/plan.ts`, `fonts/plan.ts`, `packages/apt.ts`,
 * `packages/flatpak.ts`)의 `planXUninstall` 함수가 안다.
 *
 * 이번 라운드 범위 밖 capability(snap·appimage·settings·services·scheduled·
 * tools·repos)는 여기서 정직한 사유와 함께 전부 `excluded`로 보고한다 —
 * UI가 "왜 이 항목은 삭제 후보에 안 뜨는지"를 사람이 읽는 문장으로 보여줄 수
 * 있게(엔진이 조용히 무시하지 않는다).
 */
import type { RigsyncContext } from '../context'
import { planAptUninstall } from '../capabilities/packages/apt'
import { planFlatpakUninstall } from '../capabilities/packages/flatpak'
import type { AptProvider, FlatpakProvider } from '../capabilities/packages/providerTypes'
import type { AptRemoveDependencyReport } from '../capabilities/packages/types'
import { planDotfilesUninstall } from '../capabilities/dotfiles/plan'
import { planBinariesUninstall } from '../capabilities/binaries/plan'
import { planFontsUninstall } from '../capabilities/fonts/plan'
import type { FontsSystemProvider } from '../capabilities/fonts/providerTypes'
import type { PlanAction } from '../plan'
import type { CapabilityUninstallResult, UninstallExclusion, UninstallItemRequest } from './types'

export type { CapabilityUninstallResult, UninstallExclusion, UninstallItemRequest } from './types'

export interface UninstallProviders {
  readonly apt: AptProvider
  readonly flatpak: FlatpakProvider
  readonly fontsSystem: FontsSystemProvider
}

export interface UninstallPlanResult {
  readonly actions: readonly PlanAction[]
  readonly excluded: readonly UninstallExclusion[]
  /** apt 삭제 요청이 하나라도 유효했을 때만 채워진다(안전 불변식 5 필수 조건). */
  readonly aptDependencies?: AptRemoveDependencyReport
}

/**
 * 이번 라운드가 다루지 않는 capability의 이유 — settings/services/scheduled는
 * "제거"라는 동작 자체의 의미가 모호하고(dconf 값엔 "원래 없었음"이 없을 수
 * 있고, systemd 서비스는 정의가 제각각), repos는 커밋 안 된 작업물 손실
 * 위험이라 자동화하지 않는다. tools(npm 전역 패키지)는 npm 자체의 표준
 * 제거 경로(`npm uninstall -g`)가 이미 있고, nvm/node 버전 제거는 다른
 * 프로젝트에 영향을 줄 수 있어 범위를 넓히지 않는다. snap은 정책상 애초에
 * 관리 대상이 아니다(검출 전용). appimage는 Gear Lever가 자체 제거 경로를
 * 갖고 있어(이번 스펙엔 포함되지 않음) 이번 라운드에서 별도로 다루지 않는다.
 */
const UNSUPPORTED_CAPABILITY_REASONS: Readonly<Record<string, string>> = {
  snap: 'snap은 정책상 관리 대상이 아니다(검출 전용, §7 비목표) — uninstall도 지원하지 않는다.',
  appimage:
    'appimage(Gear Lever 관리) 삭제 경로는 이번 범위 밖 — Gear Lever 자체 제거가 표준 경로다.',
  settings: 'dconf 값 "제거"는 의미가 모호하다(초기값이 없는 키가 있을 수 있음) — 이번 범위 밖.',
  services:
    'systemd user 서비스 제거는 이번 범위 밖 — 서비스 정의·타이머 조합이 다양해 일반화가 위험하다.',
  scheduled: 'cron/dconf 스케줄 항목은 "제거"의 의미가 모호하다 — 이번 범위 밖.',
  tools:
    'npm 전역 패키지 제거는 이번 범위 밖 — npm 자체의 표준 제거 경로(`npm uninstall -g`)가 이미 있고, nvm/node 버전 제거는 다른 프로젝트에 영향을 줄 수 있다.',
  repos: '클론된 레포 삭제는 커밋 안 된 작업물 손실 위험이 있어 이번 범위 밖.'
}

function unsupportedReason(capability: string): string {
  return (
    UNSUPPORTED_CAPABILITY_REASONS[capability] ??
    `capability "${capability}"는 uninstall을 지원하지 않는다.`
  )
}

/**
 * 삭제 계획 — 단건 삭제도 일괄 삭제도 같은 경로다(`items`가 길이 1이냐 여러
 * 개냐의 차이일 뿐). capability별로 묶어 각 `planXUninstall`에 위임하고,
 * apt만 여러 패키지를 한 번의 명령으로 합친다(요청 자체가 이미 apt 항목
 * 전부를 한 번에 넘기므로 별도 배치 로직이 필요 없다 — `planAptUninstall`이
 * 내부에서 합친다).
 */
export function planUninstall(
  ctx: RigsyncContext,
  providers: UninstallProviders,
  items: readonly UninstallItemRequest[],
  runTs: string
): UninstallPlanResult {
  const keysByCapability = new Map<string, string[]>()
  for (const item of items) {
    const list = keysByCapability.get(item.capability)
    if (list) list.push(item.key)
    else keysByCapability.set(item.capability, [item.key])
  }

  const actions: PlanAction[] = []
  const excluded: UninstallExclusion[] = []
  let aptDependencies: AptRemoveDependencyReport | undefined

  for (const [capability, keys] of keysByCapability) {
    let result: CapabilityUninstallResult
    switch (capability) {
      case 'dotfiles':
        result = planDotfilesUninstall(ctx, keys, runTs)
        break
      case 'apt': {
        const aptResult = planAptUninstall(ctx, providers.apt, keys)
        result = aptResult
        if (aptResult.dependencies) aptDependencies = aptResult.dependencies
        break
      }
      case 'flatpak':
        result = planFlatpakUninstall(ctx, providers.flatpak, keys)
        break
      case 'binaries':
        result = planBinariesUninstall(ctx, keys, runTs)
        break
      case 'fonts':
        result = planFontsUninstall(ctx, keys, providers.fontsSystem, runTs)
        break
      default:
        result = {
          actions: [],
          excluded: keys.map((key) => ({ capability, key, reason: unsupportedReason(capability) }))
        }
    }
    actions.push(...result.actions)
    excluded.push(...result.excluded)
  }

  return { actions, excluded, ...(aptDependencies ? { aptDependencies } : {}) }
}
