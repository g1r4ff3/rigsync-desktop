import type { DconfCommandResult, DconfProvider } from './providerTypes'

export interface FakeDconfState {
  available?: boolean
  /** path -> live dump 내용. */
  dumps?: Record<string, string>
}

export function makeFakeDconfProvider(state: FakeDconfState = {}): DconfProvider & {
  loaded: Array<{ path: string; data: string }>
} {
  const dumps = state.dumps ?? {}
  const loaded: Array<{ path: string; data: string }> = []
  return {
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증). isAvailable은 DconfProvider 인터페이스상
    // plain boolean이라(providerTypes.ts) 감싸지 않는다.
    isAvailable: () => state.available ?? true,
    dump: (p: string) => Promise.resolve(dumps[p] ?? ''),
    load: (p: string, data: string): Promise<DconfCommandResult> => {
      loaded.push({ path: p, data })
      dumps[p] = data
      return Promise.resolve({ ok: true, output: '' })
    },
    loaded
  }
}
