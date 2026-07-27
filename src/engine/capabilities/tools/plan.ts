/**
 * tools plan — 구 repo `plan_tools`(rigsync.py:1083) 행동 이식: nvm → node →
 * globals 순서. 전부 홈 디렉터리 작업이라 sudo가 필요 없다(`privileged: false`) —
 * apt와 달리 이 액션들은 테스트에서도 `run()`이 실제로 호출되므로 실제 설치
 * 호출은 전부 `ToolsProvider` 뒤로 격리한다.
 */
import type { RigsyncContext } from '../../context'
import type { PlanAction } from '../../plan'
import { DEFAULT_NVM_VERSION, NVM_SOURCE } from './constants'
import type { ToolsProvider } from './providerTypes'
import type { ToolsDiffReport } from './types'

export function planTools(
  ctx: RigsyncContext,
  provider: ToolsProvider,
  diff: ToolsDiffReport
): PlanAction[] {
  if (diff.skipped) return []
  const actions: PlanAction[] = []

  if (diff.nvmMissing) {
    const nvmVersion = ctx.settings.nvmVersion ?? DEFAULT_NVM_VERSION
    const url = `https://raw.githubusercontent.com/nvm-sh/nvm/${nvmVersion}/install.sh`
    const cmd = `curl -o- ${url} | bash`
    actions.push({
      capability: 'tools',
      summary: `install nvm ${nvmVersion}`,
      commands: [cmd],
      privileged: false,
      run: async () => {
        const result = await provider.installNvm(nvmVersion)
        return {
          ok: result.ok,
          detail: result.ok
            ? result.output || 'ok'
            : `nvm 설치 실패 (네트워크/curl 확인): ${result.output}`
        }
      }
    })
  }

  if (diff.nodeToInstall) {
    const nodeVersion = diff.nodeToInstall
    const cmd = `${NVM_SOURCE}; nvm install ${nodeVersion} && nvm alias default ${nodeVersion}`
    actions.push({
      capability: 'tools',
      summary: `nvm install ${nodeVersion} (+ alias default)`,
      commands: [cmd],
      privileged: false,
      run: async () => {
        const result = await provider.installNodeAndSetDefault(nodeVersion)
        return {
          ok: result.ok,
          detail: result.ok
            ? result.output || 'ok'
            : `node ${nodeVersion} 설치 실패 (네트워크 확인): ${result.output}`
        }
      }
    })
  }

  for (const pkg of diff.toInstall) {
    const cmd = `${NVM_SOURCE}; npm install -g ${pkg}`
    actions.push({
      capability: 'tools',
      summary: `npm install -g ${pkg}`,
      commands: [cmd],
      privileged: false,
      run: async () => {
        const result = await provider.installGlobalPackage(pkg)
        return { ok: result.ok, detail: result.output || (result.ok ? 'ok' : '설치 실패') }
      }
    })
  }

  return actions
}
