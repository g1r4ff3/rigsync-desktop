import type { CronCommandResult, CronProvider } from './providerTypes'

export interface FakeCronState {
  available?: boolean
  /** null = 사용자 crontab 자체가 없음 (구 repo의 "no crontab for user"와 동일 구분). */
  crontab?: string | null
}

export interface FakeCronProvider extends CronProvider {
  readonly writtenContents: string[]
}

export function makeFakeCronProvider(state: FakeCronState = {}): FakeCronProvider {
  let crontab = state.crontab === undefined ? null : state.crontab
  const writtenContents: string[] = []
  return {
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증). isAvailable은 CronProvider 인터페이스상
    // plain boolean이라(providerTypes.ts) 감싸지 않는다.
    isAvailable: () => state.available ?? true,
    readCrontab: () => Promise.resolve(crontab),
    writeCrontab: (content: string): Promise<CronCommandResult> => {
      crontab = content
      writtenContents.push(content)
      return Promise.resolve({ ok: true, output: '' })
    },
    writtenContents
  }
}
