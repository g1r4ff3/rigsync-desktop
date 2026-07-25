/**
 * diff → plan → execute. `executePlan`은 안전 불변식 ①에 따라 dry-run이
 * 기본이며, 실제 실행은 명시적 확인 게이트(`confirm: true`)를 통과해야 한다
 * (P1 코디네이터 확정 결정 ④). 이벤트 이름·payload 모양은 P1에서 확정된 계약:
 * `action_start {index,total,desc}` / `action_done {index,ok,error?}` /
 * `summary {ok,failed,skipped,cancelled}` — main이 그대로 `engine:planEvent`
 * IPC 채널로 renderer에 중계한다(결정 ⑤).
 *
 * capability마다 diff 결과를 이 모듈의 `PlanAction[]`으로 변환해 넘기면 되므로
 * dotfiles 전용이 아니다 — 실행기 자체는 범용.
 */
import { EventEmitter } from 'node:events'

/**
 * 실행 가능한 계획 한 항목. `commands`는 실제 셸 스크립트가 아니어도(예:
 * symlink/copy는 Node fs 호출로 직접 수행) 사용자에게 "무엇을 할지" 그대로
 * 노출할 사람이 읽는 스크립트 전문이다 (불변식 ⑥ — UI가 실행 전 그대로 보여준다).
 */
export interface PlanAction {
  readonly capability: string
  readonly summary: string
  readonly commands: readonly string[]
  /**
   * true면 부작용이 없는 순수 거부(refusal)라 confirm 여부와 무관하게 항상
   * 실행된다 — dry-run에서도 "왜 안 되는지"가 조용히 생략되지 않고 그대로
   * 보여야 하기 때문(구 repo `Action.always_run` 행동 이식).
   */
  readonly alwaysRun?: boolean
  /**
   * true면 권한 상승(sudo/pkexec)이 필요한 액션이다. `PlanExecutor`는 이
   * 액션을 **절대 직접 실행하지 않는다** — confirm·dry-run과 무관하게 항상
   * `skipped`로 보고한다(안전한 기본값·안전망). 실제 실행 경로는
   * `src/engine/elevation/`의 `ApplyRunner`가 담당한다: plan에서 privileged
   * 액션만 뽑아 pkexec 스크립트 하나로 묶어 실행하고, 그 결과를 이
   * PlanExecutor가 처리한 나머지 액션들과 같은 `action_start`/`action_done`
   * 이벤트 스트림에 합류시킨다(P2b 결정 ①·④). 이 필드/스킵 동작 자체는 P2a에서
   * 생긴 안전선이고 지금도 유효하다 — "누가 실행하느냐"가 executor에서
   * ApplyRunner로 옮겨졌을 뿐, PlanExecutor에 직접 넘겨진 privileged 액션은
   * 여전히 실행되지 않는다.
   */
  readonly privileged?: boolean
  run(): Promise<{ ok: boolean; detail: string }>
}

export type PlanActionStatus = 'ok' | 'failed' | 'refused' | 'planned' | 'skipped' | 'not-run'

export interface PlanActionResult {
  readonly capability: string
  readonly summary: string
  readonly commands: readonly string[]
  readonly status: PlanActionStatus
  readonly detail?: string
}

/** 실행 중 취소 신호 — 명령들 "사이"에서만 확인한다(협조적 소프트 취소). */
export interface CancelToken {
  isCancelled(): boolean
}

export interface ExecuteOptions {
  /** false(기본)면 dry-run — alwaysRun이 아닌 액션은 전혀 실행되지 않는다 (불변식 ①). */
  readonly confirm: boolean
  /**
   * P2b 확정 결정 ③: 취소는 명령 사이마다 체크한다 — 이미 실행 중이던 액션은
   * 항상 끝까지 마치고, 아직 시작 안 한 액션만 `not-run`으로 보고된다.
   */
  readonly cancelToken?: CancelToken
}

export interface ActionStartEvent {
  readonly index: number
  readonly total: number
  readonly desc: string
}

export interface ActionDoneEvent {
  readonly index: number
  readonly ok: boolean
  readonly error?: string
}

export interface SummaryEvent {
  readonly ok: number
  readonly failed: number
  readonly skipped: number
  readonly cancelled: number
}

export interface PlanExecutorEvents {
  action_start: [ActionStartEvent]
  action_done: [ActionDoneEvent]
  summary: [SummaryEvent]
}

/**
 * plan 실행기 — renderer는 IPC로 `action_start`/`action_done`/`summary`
 * 이벤트를 구독해 실시간 진행을 표시한다.
 */
export class PlanExecutor extends EventEmitter<PlanExecutorEvents> {
  async execute(plan: readonly PlanAction[], options: ExecuteOptions): Promise<PlanActionResult[]> {
    const results: PlanActionResult[] = []
    const total = plan.length
    let ok = 0
    let failed = 0
    let skipped = 0
    let cancelled = 0

    for (let index = 0; index < plan.length; index++) {
      const action = plan[index]

      if (options.cancelToken?.isCancelled() && !action.alwaysRun) {
        // 소프트 취소: 이전 반복의 await가 끝난 뒤에만 여기 도달하므로, 지금
        // 막 실행을 건너뛰는 액션은 아직 시작조차 안 한 것들뿐이다.
        const detail = '사용자 중단으로 실행되지 않음'
        this.emit('action_start', { index, total, desc: action.summary })
        results.push({
          capability: action.capability,
          summary: action.summary,
          commands: action.commands,
          status: 'not-run',
          detail
        })
        cancelled += 1
        this.emit('action_done', { index, ok: false, error: detail })
        continue
      }

      if (action.privileged) {
        // 권한 상승 통합(P2b) 전까지 절대 실행하지 않는다 — confirm·dry-run
        // 여부와 무관하게 항상 skipped. 명령 전문은 UI가 그대로 노출한다.
        const detail =
          '권한 상승 통합(P2b) 전까지 보류 — 아래 명령을 수동으로 실행하세요: ' +
          action.commands.join(' && ')
        this.emit('action_start', { index, total, desc: action.summary })
        results.push({
          capability: action.capability,
          summary: action.summary,
          commands: action.commands,
          status: 'skipped',
          detail
        })
        skipped += 1
        this.emit('action_done', { index, ok: false, error: detail })
        continue
      }

      if (!options.confirm && !action.alwaysRun) {
        // dry-run: 부작용이 있는 액션은 아예 실행하지 않는다 — 불변식 ①.
        const result: PlanActionResult = {
          capability: action.capability,
          summary: action.summary,
          commands: action.commands,
          status: 'planned'
        }
        results.push(result)
        skipped += 1
        this.emit('action_start', { index, total, desc: action.summary })
        this.emit('action_done', { index, ok: true })
        continue
      }

      this.emit('action_start', { index, total, desc: action.summary })
      try {
        const { ok: actionOk, detail } = await action.run()
        const status: PlanActionStatus =
          action.alwaysRun && !actionOk ? 'refused' : actionOk ? 'ok' : 'failed'
        if (status === 'ok') ok += 1
        else failed += 1 // refused도 "계획대로 실행되지 못함"이므로 failed로 집계
        results.push({
          capability: action.capability,
          summary: action.summary,
          commands: action.commands,
          status,
          detail
        })
        this.emit('action_done', {
          index,
          ok: status === 'ok',
          error: status === 'ok' ? undefined : detail
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        failed += 1
        results.push({
          capability: action.capability,
          summary: action.summary,
          commands: action.commands,
          status: 'failed',
          detail
        })
        this.emit('action_done', { index, ok: false, error: detail })
      }
    }

    this.emit('summary', { ok, failed, skipped, cancelled })
    return results
  }
}
