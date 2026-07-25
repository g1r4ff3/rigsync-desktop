/**
 * IPC 타입 계약 — main(엔진 호스트)과 renderer(React) 사이의 유일한 통로.
 * renderer는 이 파일의 타입으로만 시스템에 접근한다 (CLAUDE.md 아키텍처 규칙:
 * "renderer는 렌더만 — 시스템 접근은 전부 src/shared/의 타입드 IPC 계약을 거친다").
 *
 * 채널 이름 상수 + 요청/응답 타입을 pair로 정의한다. 실제 핸들러 등록(main)과
 * contextBridge 노출(preload)은 P1부터 붙인다 — 지금은 계약 자리표시자만.
 */

export const IPC_CHANNELS = {
  enginePing: 'engine:ping'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export interface EnginePingRequest {
  readonly message?: string
}

export interface EnginePingResponse {
  readonly ok: true
  readonly echo?: string
  readonly respondedAt: string
}
