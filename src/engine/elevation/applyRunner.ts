/**
 * plan(dotfiles+packages 등 혼합) 전체를 실행하는 최상위 오케스트레이터 —
 * 비특권 액션은 기존 `PlanExecutor`로, 특권 액션은 pkexec 스크립트 하나로
 * 묶어 실행하고 두 결과를 같은 `action_start`/`action_done`/`summary` 이벤트
 * 스트림으로 합류시킨다(P2b 확정 결정 ①·④). 구 repo `gui.py`의
 * `_run_apply_worker`/`_on_apply_clicked`/`_on_exec_cancel_clicked` 행동을
 * 옮긴 것(코드 복사 아님).
 *
 * 상태 어휘 매핑(구 repo는 "ok"/"failed"/"not-run" 셋뿐이라 여러 의미를
 * "not-run" 하나에 욱여넣었지만, 이 엔진은 P2a에서 이미 어휘가 더 풍부하다
 * — 그 구분을 그대로 살렸다는 게 의도적 차이):
 * - 명령이 전혀 시작 못 하고 pkexec 자체가 없거나(pkexec 부재)/인증이
 *   거부·실패했으면(dismissed/unauthorized) -> `skipped` (인프라가 안 됨).
 * - 사용자가 취소 버튼을 눌러서 실행 안 됐으면(코어 단계 중 취소, 또는
 *   cancel_file로 스크립트 자체가 중단) -> `not-run` (사람이 멈췄음).
 */
import fs from 'node:fs'
import { EventEmitter } from 'node:events'
import {
  PlanExecutor,
  type ActionDoneEvent,
  type ActionStartEvent,
  type CancelToken,
  type PlanAction,
  type PlanActionResult,
  type PlanActionStatus,
  type SummaryEvent
} from '../plan'
import type { ElevationExec } from './execTypes'
import { makeCancelFilePath, pkexecAvailable, safeUnlink, writeSudoScript } from './fsHelpers'
import type { SudoCommandStatus } from './parse'
import { runSudoScript, type SudoOutcome } from './runner'
import { buildSudoScript } from './script'
import { flattenPrivilegedCommands, splitPlanByPrivilege } from './split'

export interface ApplyRunnerEvents {
  action_start: [ActionStartEvent]
  action_done: [ActionDoneEvent]
  summary: [SummaryEvent]
}

export interface ApplyRunnerOptions {
  readonly confirm: boolean
  readonly elevationExec: ElevationExec
  /** 주입 가능 — 기본은 실제 `pkexec` PATH 조회 (테스트가 갈아끼운다). */
  readonly isPkexecAvailable?: () => boolean
  readonly writeScript?: (text: string) => string
  readonly makeCancelFilePath?: () => string
}

const REASON_BY_OUTCOME: Partial<Record<SudoOutcome, string>> = {
  dismissed: '관리자 인증이 취소됨 — 터미널에서 직접 실행하세요',
  unauthorized: '관리자 권한이 없음 — 터미널에서 직접 실행하세요',
  cancelled: '사용자 중단으로 실행되지 않음'
}

export class ApplyRunner extends EventEmitter<ApplyRunnerEvents> {
  private cancelRequested = false
  private sudoCancelFilePath: string | null = null

  /** UI 취소 버튼이 호출한다 — 코어 단계(PlanExecutor)와 sudo 스크립트 단계 둘 다에 신호를 보낸다. */
  cancel(): void {
    this.cancelRequested = true
    if (this.sudoCancelFilePath) {
      try {
        fs.writeFileSync(this.sudoCancelFilePath, '')
      } catch {
        // 최선의 노력 -- 실패해도 코어 단계의 cancelToken은 이미 세팅됐다.
      }
    }
  }

  async run(plan: readonly PlanAction[], options: ApplyRunnerOptions): Promise<PlanActionResult[]> {
    const [executable, privileged] = splitPlanByPrivilege(plan)
    const total = plan.length

    const cancelToken: CancelToken = { isCancelled: () => this.cancelRequested }
    const coreExecutor = new PlanExecutor()
    coreExecutor.on('action_start', (e) => this.emit('action_start', e))
    coreExecutor.on('action_done', (e) => this.emit('action_done', e))
    const coreResults = await coreExecutor.execute(executable, {
      confirm: options.confirm,
      cancelToken
    })

    const privilegedResults: PlanActionResult[] = []

    if (privileged.length > 0) {
      if (!options.confirm) {
        this.previewPrivileged(privileged, executable.length, total, privilegedResults)
      } else if (this.cancelRequested) {
        this.skipPrivileged(
          privileged,
          executable.length,
          total,
          privilegedResults,
          'not-run',
          '사용자 중단으로 실행되지 않음'
        )
      } else if (!(options.isPkexecAvailable ?? pkexecAvailable)()) {
        this.skipPrivileged(
          privileged,
          executable.length,
          total,
          privilegedResults,
          'skipped',
          'pkexec 없음 — 터미널에서 직접 실행하세요'
        )
      } else {
        await this.runPrivileged(privileged, executable.length, total, options, privilegedResults)
      }
    }

    const results = [...coreResults, ...privilegedResults]
    const summary = tallySummary(results)
    this.emit('summary', summary)
    return results
  }

  private previewPrivileged(
    privileged: readonly PlanAction[],
    offset: number,
    total: number,
    out: PlanActionResult[]
  ): void {
    privileged.forEach((action, ai) => {
      const index = offset + ai
      this.emit('action_start', { index, total, desc: action.summary })
      out.push({
        capability: action.capability,
        summary: action.summary,
        commands: action.commands,
        status: 'planned'
      })
      this.emit('action_done', { index, ok: true })
    })
  }

  private skipPrivileged(
    privileged: readonly PlanAction[],
    offset: number,
    total: number,
    out: PlanActionResult[],
    status: PlanActionStatus,
    detail: string
  ): void {
    privileged.forEach((action, ai) => {
      const index = offset + ai
      this.emit('action_start', { index, total, desc: action.summary })
      out.push({
        capability: action.capability,
        summary: action.summary,
        commands: action.commands,
        status,
        detail
      })
      this.emit('action_done', { index, ok: false, error: detail })
    })
  }

  private async runPrivileged(
    privileged: readonly PlanAction[],
    offset: number,
    total: number,
    options: ApplyRunnerOptions,
    out: PlanActionResult[]
  ): Promise<void> {
    const { commands, owner } = flattenPrivilegedCommands(privileged)
    const cancelFilePath = (options.makeCancelFilePath ?? makeCancelFilePath)()
    this.sudoCancelFilePath = cancelFilePath
    const scriptText = buildSudoScript(commands, cancelFilePath)
    const scriptPath = (options.writeScript ?? writeSudoScript)(scriptText)

    const startedActions = new Set<number>()
    let result
    try {
      result = await runSudoScript(options.elevationExec, scriptPath, commands.length, (event) => {
        if (event.kind === 'start') {
          const ai = owner[event.index]
          if (!startedActions.has(ai)) {
            startedActions.add(ai)
            this.emit('action_start', { index: offset + ai, total, desc: privileged[ai].summary })
          }
        }
      })
    } finally {
      safeUnlink(scriptPath)
      safeUnlink(cancelFilePath)
      this.sudoCancelFilePath = null
    }

    // 명령별 상태 -> 액션별 상태로 합산 (구 repo _run_apply_worker와 동일 알고리즘:
    // 하나라도 failed면 failed, 아니면 not-run이 하나라도 있으면 not-run, 아니면 ok).
    const actionStatus: SudoCommandStatus[] = privileged.map(() => 'ok')
    result.statuses.forEach((st, i) => {
      const ai = owner[i]
      if (st === 'failed') actionStatus[ai] = 'failed'
      else if (st === 'not-run' && actionStatus[ai] !== 'failed') actionStatus[ai] = 'not-run'
    })

    const reason = REASON_BY_OUTCOME[result.outcome]
    privileged.forEach((action, ai) => {
      const index = offset + ai
      const st = actionStatus[ai]
      let status: PlanActionStatus
      let detail: string | undefined
      if (st === 'ok') {
        status = 'ok'
      } else if (st === 'failed') {
        status = 'failed'
        detail = result.stderr.trim() || '실행 실패 (자세한 내용 없음)'
      } else {
        status = result.outcome === 'cancelled' ? 'not-run' : 'skipped'
        detail = reason ?? '미실행'
      }
      if (!startedActions.has(ai)) {
        // 첫 명령에서 인증 자체가 거부된 경우 등 -- CMD 마커가 하나도 안 와서
        // action_start를 못 냈으므로 여기서 뒤늦게 한 번 낸다.
        this.emit('action_start', { index, total, desc: action.summary })
      }
      out.push({
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
    })
  }
}

function tallySummary(results: readonly PlanActionResult[]): SummaryEvent {
  let ok = 0
  let failed = 0
  let skipped = 0
  let cancelled = 0
  for (const r of results) {
    if (r.status === 'ok') ok += 1
    else if (r.status === 'failed' || r.status === 'refused') failed += 1
    else if (r.status === 'not-run') cancelled += 1
    else skipped += 1 // 'planned' | 'skipped'
  }
  return { ok, failed, skipped, cancelled }
}
