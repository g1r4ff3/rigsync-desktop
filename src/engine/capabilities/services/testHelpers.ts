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
    isEnabled: (name: string) => enabled[name] ?? false,
    writeUnitFile: (name: string, content: string): ServiceCommandResult => {
      units.set(name, content)
      written.push({ name, content })
      return { ok: true, output: '' }
    },
    daemonReload: (): ServiceCommandResult => {
      reloadCallCount.count += 1
      return state.daemonReloadFails
        ? { ok: false, output: 'reload failed' }
        : { ok: true, output: '' }
    },
    enable: (name: string): ServiceCommandResult => {
      enabledCalls.push(name)
      enabled[name] = true
      return { ok: true, output: '' }
    },
    written,
    enabledCalls,
    reloadCallCount
  }
}
