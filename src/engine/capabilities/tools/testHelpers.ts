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

/**
 * `state`는 초기 스냅샷일 뿐 — install* 호출은 이후 조회(`npmNodeAvailable`/
 * `npmGlobals`/`nodeVersion`)에 실제로 반영되도록 내부에서 mutate한다(apply →
 * diff 수렴 e2e 테스트가 "설치했다고 응답한 것"과 "그 다음 diff가 보는 것"이
 * 같은 provider 상태를 공유하도록 하기 위함 — 실사용 버그가 정확히 이 둘이
 * 어긋나던 문제였다). nvm 디렉터리 자체(`~/.nvm`)는 이 fake가 아니라
 * `diffTools`가 실제 fs로 보므로, convergence 테스트는 `installNvm` 이후
 * 그 디렉터리를 직접 만들어 실제 설치 스크립트의 부수효과를 흉내낸다.
 */
export function makeFakeToolsProvider(state: FakeToolsState = {}): FakeToolsProvider {
  let available = state.available ?? true
  const globals: Record<string, string> = { ...(state.globals ?? {}) }
  let nodeVersion = state.nodeVersion ?? ''
  const installNvmCalls: string[] = []
  const installNodeCalls: string[] = []
  const installPackageCalls: string[] = []
  return {
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증) -- ToolsProvider는 전 메서드가
    // MaybePromise(providerTypes.ts).
    npmNodeAvailable: () => Promise.resolve(available),
    npmGlobals: () => Promise.resolve({ ...globals }),
    nodeVersion: () => Promise.resolve(nodeVersion),
    installNvm: (version: string): Promise<ToolsCommandResult> => {
      installNvmCalls.push(version)
      return Promise.resolve({ ok: true, output: '' })
    },
    installNodeAndSetDefault: (version: string): Promise<ToolsCommandResult> => {
      installNodeCalls.push(version)
      nodeVersion = version
      available = true
      return Promise.resolve({ ok: true, output: '' })
    },
    installGlobalPackage: (pkg: string): Promise<ToolsCommandResult> => {
      installPackageCalls.push(pkg)
      globals[pkg] = 'installed'
      return Promise.resolve({ ok: true, output: '' })
    },
    installNvmCalls,
    installNodeCalls,
    installPackageCalls
  }
}
