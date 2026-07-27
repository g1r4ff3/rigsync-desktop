/**
 * 엔진 워커 메시지 디스패치의 동시성 규율 — 성능 리팩토링 2라운드(v0.1.17)
 * 2단계. `engineWorker.ts`의 메시지 루프는 이미 `void dispatch(...)`라 다음
 * 메시지 수신을 막지 않는다(요청을 await하지 않고 흘려보냄). 하지만 그것만으론
 * 두 문제가 남는다:
 *
 * 1. **레이스** — capture/apply 같은 변조 연산이 diff 같은 읽기 연산과 동시에
 *    돌면, 읽기가 반쯤 쓰인 manifest를 볼 수 있다. 변조 연산끼리도 동시 실행되면
 *    같은 파일에 두 번 쓰기가 겹칠 수 있다.
 * 2. **중복 조회** — 앱 기동 시 여러 탭이 동시에 `diffPackages`를 부르면(예:
 *    Diff 화면 + Candidates 화면이 동시에 마운트), 완전히 같은 apt/flatpak
 *    조회를 프로세스가 두 번 spawn한다.
 *
 * 이 모듈이 그 둘을 각각 해소한다:
 * - **{@link ReadWriteLock}**: 읽기 연산끼리는 동시 실행 허용, 변조 연산은
 *   배타적(읽기·변조 전부와 겹치지 않음). 표준 reader-writer lock이되, FIFO
 *   큐라 새치기(writer starvation)가 없다 — 대기 중인 변조 앞에 줄 선 읽기들은
 *   먼저 실행되지만, 그 뒤에 도착한 읽기는 변조가 끝날 때까지 큐잉된다
 *   (스펙 "변조 중 읽기는 큐잉" 조항).
 * - **{@link RequestScheduler}**: 동일 메서드+동일 args의 in-flight 요청을
 *   같은 Promise로 병합(coalescing)한다. 어떤 메서드를 병합 대상으로 할지는
 *   호출부(`engineWorker.ts`)가 `coalesce()`로 명시한다 — 기본은 읽기 전용
 *   (변조는 멱등이 아닐 수 있어 자동 병합하지 않는다. 예: 같은 apply 요청이
 *   두 번 오면 결과를 공유하는 게 아니라 배타 락으로 순차 실행되는 쪽이 안전).
 *
 * `cancelApply`처럼 락 자체를 우회해야 하는 메서드(진행 중인 변조를 중단시키는
 * 신호라 그 변조의 배타 락 뒤에 줄서면 영원히 실행 못 됨)는 `classify()`가
 * `'unlocked'`을 반환해 락을 아예 거치지 않는다.
 */

export type MethodKind = 'read' | 'write' | 'unlocked'

interface QueueEntry {
  readonly kind: 'read' | 'write'
  readonly grant: () => void
}

/**
 * 표준 reader-writer lock — 읽기는 동시 다중 허용, 쓰기는 완전 배타(읽기·쓰기
 * 전부와 겹치지 않음). FIFO 큐: 도착 순서대로만 진입을 허용해 굶주림을 막는다.
 */
export class ReadWriteLock {
  private readers = 0
  private writing = false
  private readonly queue: QueueEntry[] = []

  private pump(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0]
      if (next.kind === 'read') {
        if (this.writing) break
        this.queue.shift()
        this.readers++
        next.grant()
        continue // 뒤이은 읽기도 같이 진입시킨다 (읽기끼리는 동시 허용).
      }
      // kind === 'write': 진행 중인 읽기·쓰기가 전부 빠질 때까지 대기.
      if (this.writing || this.readers > 0) break
      this.queue.shift()
      this.writing = true
      next.grant()
      break
    }
  }

  private acquireRead(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ kind: 'read', grant: resolve })
      this.pump()
    })
  }

  private releaseRead(): void {
    this.readers--
    this.pump()
  }

  private acquireWrite(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ kind: 'write', grant: resolve })
      this.pump()
    })
  }

  private releaseWrite(): void {
    this.writing = false
    this.pump()
  }

  async withRead<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireRead()
    try {
      return await fn()
    } finally {
      this.releaseRead()
    }
  }

  async withWrite<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireWrite()
    try {
      return await fn()
    } finally {
      this.releaseWrite()
    }
  }
}

/** args(JSON 가능한 요청 payload)를 키에 넣기 전에 객체 키 순서를 정규화한다. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

export interface RequestSchedulerOptions {
  /** 메서드별 락 취급 — 'read'|'write'|'unlocked'. */
  readonly classify: (method: string) => MethodKind
  /** true면 동일 메서드+동일 args의 in-flight 요청을 같은 Promise로 병합한다. */
  readonly coalesce: (method: string) => boolean
}

/**
 * `engineWorker.ts`의 각 메서드 실행을 이 스케줄러에 맡기면 락 취급·병합이
 * 호출부 코드 없이 일관되게 적용된다 — `dispatch()`는 `scheduler.run(method,
 * args, () => handler(args))`만 부르면 된다.
 */
export class RequestScheduler {
  private readonly lock = new ReadWriteLock()
  private readonly inFlight = new Map<string, Promise<unknown>>()

  constructor(private readonly opts: RequestSchedulerOptions) {}

  run(method: string, args: unknown, exec: () => Promise<unknown>): Promise<unknown> {
    const shouldCoalesce = this.opts.coalesce(method)
    const key = shouldCoalesce ? `${method}:${stableStringify(args)}` : undefined

    if (key) {
      const existing = this.inFlight.get(key)
      if (existing) return existing
    }

    const kind = this.opts.classify(method)
    const locked = (): Promise<unknown> => {
      if (kind === 'read') return this.lock.withRead(exec)
      if (kind === 'write') return this.lock.withWrite(exec)
      return exec()
    }

    const promise = locked()
    if (key) {
      this.inFlight.set(key, promise)
      // 성공/실패 무관하게 정리 — 실패한 요청을 캐시해두면 재시도가 막힌다.
      // 이 체인은 정리용 부수효과일 뿐 결과를 소비하지 않으므로, 원본 reject를
      // 그대로 흘려보내면 호출부가 이미 처리한 거부가 "unhandled rejection"으로
      // 또 잡힌다 — .catch(() => {})로 이 체인에서만 삼킨다.
      void promise
        .finally(() => {
          if (this.inFlight.get(key) === promise) this.inFlight.delete(key)
        })
        .catch(() => {})
    }
    return promise
  }
}
