/**
 * F2 host 계층 이동(docs/refactor-spec-v0.2.md F2) dispatcher — "이 머신
 * 전용" 전환 UI·IPC 경계가 아는 유일한 진입점. capability별 실제 구현은
 * 각 캐퍼빌리티 안의 `hostLayer.ts`에 있다(role 가드도 거기서 각자 한다 —
 * capture.ts류가 이미 쓰는 "capability 함수는 독립적으로 안전해야 한다"
 * 관례를 그대로 따름). 여기는 라우팅만 한다.
 *
 * 범위(P2 실증 사례가 있는 capability만): dotfiles·services. scheduled는
 * 이미 파일 단위 host 스토어(store.ts)라 이 이동 연산이 필요 없고, packages는
 * 이번 범위 밖(구조가 다르고 실증 사례가 없음).
 */
import {
  moveDotfileEntryToCommonLayer,
  moveDotfileEntryToHostLayer
} from './capabilities/dotfiles/hostLayer'
import {
  moveServiceEntryToCommonLayer,
  moveServiceEntryToHostLayer
} from './capabilities/services/hostLayer'
import type { RigsyncContext } from './context'

export type HostLayerCapability = 'dotfiles' | 'services'

export function moveEntryToHostLayer(
  ctx: RigsyncContext,
  capability: HostLayerCapability,
  key: string
): void {
  if (capability === 'dotfiles') {
    moveDotfileEntryToHostLayer(ctx, key)
  } else {
    moveServiceEntryToHostLayer(ctx, key)
  }
}

export function moveEntryToCommonLayer(
  ctx: RigsyncContext,
  capability: HostLayerCapability,
  key: string
): void {
  if (capability === 'dotfiles') {
    moveDotfileEntryToCommonLayer(ctx, key)
  } else {
    moveServiceEntryToCommonLayer(ctx, key)
  }
}

export { HostLayerEntryNotFoundError } from './capabilities/hostLayerErrors'
