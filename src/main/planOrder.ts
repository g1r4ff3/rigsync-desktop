/**
 * Apply 통합 plan의 capability 순서 — P3 패리티 갭 #1 해소. 구 CLI
 * `cmd_bootstrap`(rigsync.py:2332)은 repos clone을 다른 모든 레이어보다 먼저
 * 실행했다(다른 레이어가 방금 clone된 저장소 내용에 의존할 가능성 대비 —
 * 예: dotfiles 심링크가 `~/repos/dotfiles-store`를 가리키는 경우). 이 repo는
 * CLI의 `bootstrap`/`apply`를 구분하지 않고 하나의 통합 Apply로 합쳤으므로,
 * repos를 배열 맨 앞에 두는 순서 보장을 이 순수 함수 하나로 캡슐화한다
 * (`buildCombinedPlan`이 실제 diff/plan 호출 — 여기는 결과 배열을 합치는
 * 순서만 책임져 실제 시스템 provider 없이 유닛 테스트 가능하다).
 */
import type { PlanAction } from '../engine/plan'

export interface PlanPartsByCapability {
  readonly repos: readonly PlanAction[]
  readonly dotfiles: readonly PlanAction[]
  readonly packages: readonly PlanAction[]
  readonly appimage: readonly PlanAction[]
  readonly fonts: readonly PlanAction[]
  readonly binaries: readonly PlanAction[]
  readonly settings: readonly PlanAction[]
  readonly services: readonly PlanAction[]
  readonly scheduled: readonly PlanAction[]
  readonly tools: readonly PlanAction[]
}

export function orderCombinedPlan(parts: PlanPartsByCapability): PlanAction[] {
  return [
    ...parts.repos,
    ...parts.dotfiles,
    ...parts.packages,
    ...parts.appimage,
    ...parts.fonts,
    ...parts.binaries,
    ...parts.settings,
    ...parts.services,
    ...parts.scheduled,
    ...parts.tools
  ]
}
