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

/**
 * WS4("창고 모델 1차") 등록 — `register: <machineId> <capability>:<key>`.
 * `engineRegisterEntry`(engineWorker.ts)가 커밋 메시지로 쓴다 — git 저작
 * 결과를 await해 응답에 동봉하는 별도 조립 경로라 `withAuthoredWrite`를
 * 쓰지 않는다(엔진 워커 주석 참조).
 */
export function registerEntryCommitMessage(
  machineId: string,
  capability: string,
  key: string
): string {
  return `register: ${machineId} ${capability}:${key}`
}

/** WS4 삭제(카탈로그 제외) — `unregister: <machineId> <capability>:<key>`. */
export function unregisterEntryCommitMessage(
  machineId: string,
  capability: string,
  key: string
): string {
  return `unregister: ${machineId} ${capability}:${key}`
}

/** WS4 구독 토글(단건) — `select: <machineId> <capability>:<key> (on|off)`. */
export function selectToggleCommitMessage(
  machineId: string,
  capability: string,
  key: string,
  subscribed: boolean
): string {
  return `select: ${machineId} ${capability}:${key} (${subscribed ? 'on' : 'off'})`
}

/** WS4 구독 토글(벌크) — `select: <machineId> <capability> N건`. */
export function selectToggleBulkCommitMessage(
  machineId: string,
  capability: string,
  count: number
): string {
  return `select: ${machineId} ${capability} ${count}건`
}

/** WS4 구독 모드 전환 — `select: <machineId> mode=<mode>`. */
export function selectModeCommitMessage(machineId: string, mode: string): string {
  return `select: ${machineId} mode=${mode}`
}
