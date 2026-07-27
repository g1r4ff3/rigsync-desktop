import type { ServiceCommandResult, ServiceUnitFile, SystemdUserProvider } from './providerTypes'

export interface FakeSystemdUserState {
  units?: ServiceUnitFile[]
  enabled?: Record<string, boolean>
  daemonReloadFails?: boolean
}

export interface FakeSystemdUserProvider extends SystemdUserProvider {
  readonly written: Array<{ name: string; content: string }>
  readonly enabledCalls: string[]
  readonly reloadCallCount: { count: number }
}

export function makeFakeSystemdUserProvider(
  state: FakeSystemdUserState = {}
): FakeSystemdUserProvider {
  const units = new Map((state.units ?? []).map((u) => [u.name, u.content]))
  const enabled = { ...(state.enabled ?? {}) }
  const written: Array<{ name: string; content: string }> = []
  const enabledCalls: string[] = []
  const reloadCallCount = { count: 0 }

  return {
    listUnitFiles: () => [...units.entries()].map(([name, content]) => ({ name, content })),
    readUnitFile: (name: string) => (units.has(name) ? (units.get(name) ?? '') : null),
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 재발 시 여기서 fake 반환값이 Promise 객체가 되어
    // assert가 깨진다 -- services/diff.ts:34 await 누락의 교차 검증).
    isEnabled: (name: string) => Promise.resolve(enabled[name] ?? false),
    writeUnitFile: (name: string, content: string): ServiceCommandResult => {
      units.set(name, content)
      written.push({ name, content })
      return { ok: true, output: '' }
    },
    daemonReload: (): Promise<ServiceCommandResult> => {
      reloadCallCount.count += 1
      return Promise.resolve(
        state.daemonReloadFails ? { ok: false, output: 'reload failed' } : { ok: true, output: '' }
      )
    },
    enable: (name: string): Promise<ServiceCommandResult> => {
      enabledCalls.push(name)
      enabled[name] = true
      return Promise.resolve({ ok: true, output: '' })
    },
    written,
    enabledCalls,
    reloadCallCount
  }
}
