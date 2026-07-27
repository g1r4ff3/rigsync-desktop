/**
 * `src/main/engineWorker.ts`를 `utilityProcess`로 fork해 대화하는 main 쪽
 * 클라이언트 — 성능 리팩토링 2단계(perf: 엔진 utilityProcess 분리)의 main
 * 절반. `ipc.ts`는 이 클라이언트의 `call()`만 쓰는 얇은 프록시가 된다.
 *
 * 책임:
 * - fork + `{id, method, args}` 요청/`{id, ok, result|error}` 응답 상관.
 * - 워커가 진행 중 보내는 `{type:'event', channel, payload}`를 구독자에게 전달
 *   (`engine:apply`/`engine:runUninstall`의 `action_start`/`action_done`/`summary`).
 * - 워커 크래시 시: 대기 중이던 요청은 전부 에러로 reject(조용한 유실 금지)하고
 *   자동 재기동한다.
 *
 * **실행 확인(2026-07-27, 스크린샷 하네스로 전 11스텝 통과)** 중 발견한 함정:
 * 앱이 `app.quit()`으로 종료되면 Electron이 살아있는 utilityProcess도 함께
 * 정리하는데, 이 client의 `exit` 핸들러가 그걸 "예기치 않은 크래시"로 오인해
 * 재기동을 시도했다(죽어가는 앱 위에 orphan 프로세스를 새로 띄우는 꼴). main이
 * `dispose()`를 명시적으로 호출해 "이건 의도된 종료"라고 알려줘야 한다
 * (`index.ts`의 `before-quit`에서 `tray.destroy()`/`scheduler.stop()`과 같은
 * 자리에).
 */
import { utilityProcess, type UtilityProcess } from 'electron'

interface PendingRequest {
  readonly resolve: (value: unknown) => void
  readonly reject: (err: Error) => void
}

type WorkerOutbound =
  | { readonly type: 'ready' }
  | { readonly type: 'event'; readonly channel: string; readonly payload: unknown }
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: { message: string; stack?: string } }

export interface EngineWorkerClientOptions {
  readonly modulePath: string
  /** 워커가 진행 중 보내는 이벤트(예: engine:planEvent)를 그대로 전달한다. */
  readonly onEvent: (channel: string, payload: unknown) => void
  /** 재기동 전 대기 시간(ms) — 테스트가 아니면 기본값 그대로 둔다. */
  readonly restartDelayMs?: number
}

/** 워커가 예기치 않게 죽었을 때 대기 중이던 요청에 돌려줄 에러 메시지. */
const WORKER_CRASHED_MESSAGE = '엔진 워커가 예기치 않게 종료됨 — 다시 시도하세요'

export class EngineWorkerClient {
  private child: UtilityProcess | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private ready: Promise<void> = Promise.resolve()
  private restarting = false
  /** true면 `dispose()`로 의도된 종료 — exit 핸들러가 재기동·에러 로그를 건너뛴다. */
  private disposed = false

  constructor(private readonly opts: EngineWorkerClientOptions) {
    this.spawn()
  }

  private spawn(): void {
    const child = utilityProcess.fork(this.opts.modulePath, [], {
      serviceName: 'rigsync-engine-worker',
      stdio: 'inherit'
    })
    this.child = child

    let resolveReady!: () => void
    this.ready = new Promise((resolve) => {
      resolveReady = resolve
    })

    child.on('message', (message: WorkerOutbound) => {
      if ('type' in message && message.type === 'ready') {
        resolveReady()
        return
      }
      if ('type' in message && message.type === 'event') {
        this.opts.onEvent(message.channel, message.payload)
        return
      }
      const res = message as Extract<WorkerOutbound, { id: number }>
      const pending = this.pending.get(res.id)
      if (!pending) return
      this.pending.delete(res.id)
      if (res.ok) {
        pending.resolve(res.result)
      } else {
        pending.reject(Object.assign(new Error(res.error.message), { stack: res.error.stack }))
      }
    })

    child.on('exit', (code) => {
      const failed = [...this.pending.values()]
      this.pending.clear()
      for (const p of failed) p.reject(new Error(WORKER_CRASHED_MESSAGE))
      if (this.disposed) return // dispose()가 이미 호출됨 -- 앱이 종료 중, 재기동하지 않는다.
      console.error(`[engine-worker] 예기치 않게 종료됨 (code=${code}) — 재기동합니다`)
      if (this.restarting) return
      this.restarting = true
      setTimeout(() => {
        this.restarting = false
        this.spawn()
      }, this.opts.restartDelayMs ?? 500)
    })
  }

  async call<T = unknown>(method: string, args: unknown = {}): Promise<T> {
    await this.ready
    const child = this.child
    if (!child) throw new Error('엔진 워커가 실행 중이 아닙니다')
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      child.postMessage({ id, method, args })
    })
  }

  /** 앱 종료(`before-quit`)에서 호출 — 이후의 워커 종료는 재기동 대상이 아니다. */
  dispose(): void {
    this.disposed = true
    this.child?.kill()
  }
}
