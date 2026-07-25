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
    isAvailable: () => state.available ?? true,
    dump: (p: string) => dumps[p] ?? '',
    load: (p: string, data: string): DconfCommandResult => {
      loaded.push({ path: p, data })
      dumps[p] = data
      return { ok: true, output: '' }
    },
    loaded
  }
}
