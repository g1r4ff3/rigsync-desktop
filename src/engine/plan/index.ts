/**
 * diff → plan → execute. execute는 이벤트 emitter로 진행 상황을 흘려보낸다
 * (구 rigsync의 progress_cb 구조의 TS 버전 — FORWARD.md §3). 실행은 안전
 * 불변식 ①에 따라 dry-run이 기본이며, 실제 실행은 명시적 확인 게이트
 * (`yes: true`)를 통과해야 한다.
 */
import { EventEmitter } from 'node:events'

export type PlanStepStatus = 'pending' | 'ok' | 'failed' | 'skipped'

export interface PlanStep {
  readonly id: string
  readonly description: string
  /** 실제 시스템 변조 전 사용자에게 노출할 스크립트 전문 (불변식 ⑥). */
  readonly script?: string
}

export interface PlanStepResult {
  readonly step: PlanStep
  readonly status: PlanStepStatus
  readonly detail?: string
}

export interface ExecuteOptions {
  /** false(기본)면 dry-run — 실제로 아무것도 변조하지 않는다 (불변식 ①). */
  readonly yes: boolean
}

export interface PlanExecutorEvents {
  step: [result: PlanStepResult]
  done: [results: PlanStepResult[]]
}

/**
 * plan 실행기 — 렌더러는 IPC로 `step`/`done` 이벤트를 구독해 실시간 진행을
 * 표시한다. P0에서는 이벤트 계약만 세우고 실제 execute 로직은 P1에서 채운다.
 */
export class PlanExecutor extends EventEmitter<PlanExecutorEvents> {
  async execute(steps: readonly PlanStep[], options: ExecuteOptions): Promise<PlanStepResult[]> {
    void steps
    void options
    throw new Error('PlanExecutor.execute: not implemented yet (P1 walking skeleton)')
  }
}
