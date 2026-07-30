/**
 * F2 host 계층 이동(docs/refactor-spec-v0.2.md F2) 공용 에러 — dotfiles·services
 * 양쪽 구현(hostLayer.ts)과 dispatcher(../hostLayerMove.ts)가 같이 쓴다. 의존성
 * 없는 leaf 모듈로 둔 이유: dispatcher -> capability impl -> dispatcher 순환
 * import를 피하기 위해서다(dispatcher가 impl을 import하므로 impl이 다시
 * dispatcher를 import하면 순환이 생긴다).
 *
 * WS5("창고 모델" 전 머신 저작, cheerful-growing-fairy 계획): 이전엔 여기에
 * `FollowerHostLayerMoveBlockedError`(host 계층 이동의 role 가드)도 있었지만,
 * 이 라운드부터 host 계층 이동은 전 머신 허용으로 바뀌어 무사용이 되어
 * 제거했다(capture 저작 10곳의 role 가드는 이번 범위 밖 — 그대로 유지).
 */

export class HostLayerEntryNotFoundError extends Error {
  constructor(capability: 'dotfiles' | 'services', key: string) {
    super(`host 계층 이동 대상 항목을 찾을 수 없습니다 (${capability}): ${key}`)
    this.name = 'HostLayerEntryNotFoundError'
  }
}
