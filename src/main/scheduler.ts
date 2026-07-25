/**
 * drift 체크 스케줄러 — P3 "판단은 엔진, 배선은 main" 분업의 main 절반.
 * `src/engine/drift.ts`(`shouldNotify`)만 의존하고 electron은 전혀 import하지
 * 않는다 — 타이머 함수·체크 함수·알림 콜백을 전부 주입받으므로 fake timer로
 * 유닛 테스트 가능하다(실제 electron Notification/Tray 연결은
 * `src/main/index.ts`가 조립할 때 주입).
 *
 * 타이머 정책(코디네이터 확정): 시작 5분 후 첫 체크, 이후
 * `ctx.settings.driftCheckIntervalHours` 간격으로 반복. **0이면 스케줄러
 * 전체를 비활성화**(첫 체크도 하지 않음) — "간격 0"을 "감시 끔"으로 해석했다
 * (0시간마다 무한反복 체크는 무의미하므로, 반복만 끄고 최초 1회는 강행하는
 * 대안보다 "완전히 끔"이 사용자 의도에 더 부합한다고 판단 — 의도적 해석).
 */
import { shouldNotify, type DriftSummary } from '../engine/drift'

export interface SchedulerDeps {
  /** read-only diff만 실행해 DriftSummary를 만든다 (main/driftCheck.ts). */
  readonly runCheck: () => Promise<DriftSummary>
  /** `shouldNotify`가 true를 반환했을 때만 호출된다. */
  readonly notify: (summary: DriftSummary) => void
  /** 반복 간격(시간). 0이면 스케줄러가 아무것도 하지 않는다. */
  readonly intervalHours: number
  /** 시작부터 첫 체크까지의 지연(ms) — 기본 5분, 테스트가 짧게 오버라이드. */
  readonly firstCheckDelayMs?: number
  readonly setTimeoutFn?: typeof setTimeout
  readonly clearTimeoutFn?: typeof clearTimeout
  readonly setIntervalFn?: typeof setInterval
  readonly clearIntervalFn?: typeof clearInterval
  /** 체크 실패(예: provider 예외) 시 호출 — 기본은 console.error. */
  readonly onError?: (err: unknown) => void
}

export const DEFAULT_FIRST_CHECK_DELAY_MS = 5 * 60 * 1000

export interface DriftCheckScheduler {
  /** 타이머를 건다 (이미 걸려 있으면 먼저 멈추고 다시 건다). intervalHours===0이면 무동작. */
  start(): void
  /** 타이머를 전부 멈춘다. */
  stop(): void
  /** 스케줄과 무관하게 지금 즉시 1회 체크한다 (트레이 "지금 확인"). */
  runNow(): Promise<void>
  /** 마지막으로 완료된 체크 결과 (아직 한 번도 안 돌았으면 null). */
  getLastResult(): DriftSummary | null
}

export function createDriftCheckScheduler(deps: SchedulerDeps): DriftCheckScheduler {
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout
  const setIntervalFn = deps.setIntervalFn ?? setInterval
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval
  const firstCheckDelayMs = deps.firstCheckDelayMs ?? DEFAULT_FIRST_CHECK_DELAY_MS
  const onError =
    deps.onError ?? ((err: unknown) => console.error('[rigsync] drift check failed', err))

  let lastResult: DriftSummary | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let intervalHandle: ReturnType<typeof setInterval> | null = null

  async function performCheck(): Promise<void> {
    try {
      const curr = await deps.runCheck()
      if (shouldNotify(lastResult, curr)) {
        deps.notify(curr)
      }
      lastResult = curr
    } catch (err) {
      onError(err)
    }
  }

  function stop(): void {
    if (timeoutHandle !== null) {
      clearTimeoutFn(timeoutHandle)
      timeoutHandle = null
    }
    if (intervalHandle !== null) {
      clearIntervalFn(intervalHandle)
      intervalHandle = null
    }
  }

  function start(): void {
    stop()
    if (deps.intervalHours <= 0) return

    timeoutHandle = setTimeoutFn(() => {
      timeoutHandle = null
      void performCheck()
      intervalHandle = setIntervalFn(() => void performCheck(), deps.intervalHours * 60 * 60 * 1000)
    }, firstCheckDelayMs)
  }

  return {
    start,
    stop,
    runNow: performCheck,
    getLastResult: () => lastResult
  }
}
