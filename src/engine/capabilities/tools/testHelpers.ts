import type { ToolsCommandResult, ToolsProvider } from './providerTypes'

export interface FakeToolsState {
  available?: boolean
  globals?: Record<string, string>
  nodeVersion?: string
}

export interface FakeToolsProvider extends ToolsProvider {
  readonly installNvmCalls: string[]
  readonly installNodeCalls: string[]
  readonly installPackageCalls: string[]
}

export function makeFakeToolsProvider(state: FakeToolsState = {}): FakeToolsProvider {
  const installNvmCalls: string[] = []
  const installNodeCalls: string[] = []
  const installPackageCalls: string[] = []
  return {
    npmNodeAvailable: () => state.available ?? true,
    npmGlobals: () => state.globals ?? {},
    nodeVersion: () => state.nodeVersion ?? '',
    installNvm: (version: string): ToolsCommandResult => {
      installNvmCalls.push(version)
      return { ok: true, output: '' }
    },
    installNodeAndSetDefault: (version: string): ToolsCommandResult => {
      installNodeCalls.push(version)
      return { ok: true, output: '' }
    },
    installGlobalPackage: (pkg: string): ToolsCommandResult => {
      installPackageCalls.push(pkg)
      return { ok: true, output: '' }
    },
    installNvmCalls,
    installNodeCalls,
    installPackageCalls
  }
}
