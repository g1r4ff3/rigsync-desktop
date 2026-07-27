/**
 * F2 host 계층 이동(docs/refactor-spec-v0.2.md F2) 공용 에러 — dotfiles·services
 * 양쪽 구현(hostLayer.ts)과 dispatcher(../hostLayerMove.ts)가 같이 쓴다. 의존성
 * 없는 leaf 모듈로 둔 이유: dispatcher -> capability impl -> dispatcher 순환
 * import를 피하기 위해서다(dispatcher가 impl을 import하므로 impl이 다시
 * dispatcher를 import하면 순환이 생긴다).
 */

export class FollowerHostLayerMoveBlockedError extends Error {
  constructor() {
    super(
      'host 계층 이동은 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        '거부합니다 (manifest 저작은 reference에서만 합니다).'
    )
    this.name = 'FollowerHostLayerMoveBlockedError'
  }
}

export class HostLayerEntryNotFoundError extends Error {
  constructor(capability: 'dotfiles' | 'services', key: string) {
    super(`host 계층 이동 대상 항목을 찾을 수 없습니다 (${capability}): ${key}`)
    this.name = 'HostLayerEntryNotFoundError'
  }
}
