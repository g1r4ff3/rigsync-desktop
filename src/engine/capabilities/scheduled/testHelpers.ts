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
    isAvailable: () => state.available ?? true,
    readCrontab: () => crontab,
    writeCrontab: (content: string): CronCommandResult => {
      crontab = content
      writtenContents.push(content)
      return { ok: true, output: '' }
    },
    writtenContents
  }
}
