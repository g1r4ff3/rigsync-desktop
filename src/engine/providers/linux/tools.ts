/**
 * 실제 nvm/node/npm 조회+설치 — `ToolsProvider`의 Linux 구현. 구 repo
 * `probe_npm_globals`/`probe_node_version`/`plan_tools`(rigsync.py:567-1120)
 * 행동 이식. 설치 명령은 전부 홈 디렉터리 작업이라 sudo를 쓰지 않는다.
 */
import { spawnSync } from 'node:child_process'
import { NVM_SOURCE } from '../../capabilities/tools/constants'
import type { ToolsCommandResult, ToolsProvider } from '../../capabilities/tools/providerTypes'
import { commandExists, run } from './exec'

export class LinuxToolsProvider implements ToolsProvider {
  npmNodeAvailable(): boolean {
    return commandExists('npm') && commandExists('node')
  }

  npmGlobals(): Record<string, string> {
    if (!commandExists('npm')) return {}
    const result = run(['npm', 'ls', '-g', '--depth=0', '--json'], 30_000)
    if (!result.stdout.trim()) return {}
    try {
      const data = JSON.parse(result.stdout) as {
        dependencies?: Record<string, { version?: string }>
      }
      const deps = data.dependencies ?? {}
      const out: Record<string, string> = {}
      for (const [name, info] of Object.entries(deps)) {
        if (name === 'npm') continue
        out[name] = info.version ?? ''
      }
      return out
    } catch {
      return {}
    }
  }

  nodeVersion(): string {
    if (!commandExists('node')) return ''
    const result = run(['node', '--version'])
    return result.stdout.trim()
  }

  installNvm(nvmVersion: string): ToolsCommandResult {
    const url = `https://raw.githubusercontent.com/nvm-sh/nvm/${nvmVersion}/install.sh`
    return runBash(`curl -o- ${url} | bash`, 600_000)
  }

  installNodeAndSetDefault(nodeVersion: string): ToolsCommandResult {
    return runBash(
      `${NVM_SOURCE}; nvm install ${nodeVersion} && nvm alias default ${nodeVersion}`,
      1_200_000
    )
  }

  installGlobalPackage(pkg: string): ToolsCommandResult {
    return runBash(`${NVM_SOURCE}; npm install -g ${pkg}`, 300_000)
  }
}

function runBash(cmd: string, timeoutMs: number): ToolsCommandResult {
  const result = spawnSync('bash', ['-c', cmd], { encoding: 'utf-8', timeout: timeoutMs })
  const output = ((result.stdout ?? '') + (result.stderr ?? '')).slice(-2000)
  if (result.error || result.status !== 0) {
    return { ok: false, output }
  }
  return { ok: true, output }
}
