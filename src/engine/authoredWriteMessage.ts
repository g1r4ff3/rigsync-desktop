/**
 * WS5("창고 모델 1차" — cheerful-growing-fairy 계획) 전 머신 저작 커밋 메시지
 * 어휘 — `engineWorker.ts`의 `withAuthoredWrite` 핸들러들이 쓴다. 커밋
 * 메시지 자체가 등록/토글/host 계층 이동의 provenance 기록이므로(git은
 * 안 보이지만 이력은 남는다, FORWARD.md §2) 순수 함수로 분리해 여기서
 * 직접 테스트한다(렌더러가 아닌 engine 쪽에 둔 이유 — 계획서 지시).
 */

/** ignore 토글(단건) — `ignore: <machineId> <capability>:<key> (on|off)`. */
export function ignoreToggleCommitMessage(
  machineId: string,
  capability: string,
  key: string,
  ignored: boolean
): string {
  return `ignore: ${machineId} ${capability}:${key} (${ignored ? 'on' : 'off'})`
}

/** ignore 토글(벌크) — `ignore: <machineId> <capability> N건`. */
export function ignoreToggleBulkCommitMessage(
  machineId: string,
  capability: string,
  count: number
): string {
  return `ignore: ${machineId} ${capability} ${count}건`
}

/** host 계층 이동 — `host-layer: <machineId> <capability>:<key> (host|common)`. */
export function hostLayerMoveCommitMessage(
  machineId: string,
  capability: string,
  key: string,
  target: 'host' | 'common'
): string {
  return `host-layer: ${machineId} ${capability}:${key} (${target})`
}
