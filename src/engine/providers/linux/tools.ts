/**
 * 실제 nvm/node/npm 조회+설치 — `ToolsProvider`의 Linux 구현. 구 repo
 * `probe_npm_globals`/`probe_node_version`/`plan_tools`(rigsync.py:567-1120)
 * 행동 이식. 설치 명령은 전부 홈 디렉터리 작업이라 sudo를 쓰지 않는다.
 *
 * **탐지·설치는 반드시 같은 환경에서 실행한다** (실사용 버그 수정, 2026-07-26):
 * GUI로 뜬 Electron 앱의 `process.env.PATH`엔 nvm이 없다(로그인 셸이 아니라
 * `nvm.sh`를 source한 적이 없어서) — 예전엔 설치 명령만 `NVM_SOURCE`를 붙이고
 * 탐지(`commandExists`/`node --version`)는 그냥 PATH를 봐서, apply로 이미
 * 설치된 node/npm을 diff가 영원히 "없음"으로 봤다(apply 후에도 diff가
 * 수렴하지 않는 원인). 탐지도 설치와 똑같이 `NVM_SOURCE`를 source한 bash로
 * 실행해 한 곳(`runInToolEnv`)에서 관리한다. nvm이 없는 머신에선 `NVM_SOURCE`의
 * `[ -s "$NVM_DIR/nvm.sh" ] && .`가 조용히 no-op돼 기존과 동일하게 상속받은
 * PATH로 폴백한다(빈 결과가 나오되 에러는 아니다).
 */
import { NVM_SOURCE } from '../../capabilities/tools/constants'
import type { ToolsCommandResult, ToolsProvider } from '../../capabilities/tools/providerTypes'
import { run } from './exec'

export class LinuxToolsProvider implements ToolsProvider {
  async npmNodeAvailable(): Promise<boolean> {
    const result = await runInToolEnv(
      'command -v npm >/dev/null 2>&1 && command -v node >/dev/null 2>&1'
    )
    return result.code === 0
  }

  async npmGlobals(): Promise<Record<string, string>> {
    const result = await runInToolEnv('npm ls -g --depth=0 --json', 30_000)
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

  async nodeVersion(): Promise<string> {
    const result = await runInToolEnv('node --version')
    return result.stdout.trim()
  }

  async installNvm(nvmVersion: string): Promise<ToolsCommandResult> {
    const url = `https://raw.githubusercontent.com/nvm-sh/nvm/${nvmVersion}/install.sh`
    return runBash(`curl -o- ${url} | bash`, 600_000)
  }

  async installNodeAndSetDefault(nodeVersion: string): Promise<ToolsCommandResult> {
    return runBash(
      `${NVM_SOURCE}; nvm install ${nodeVersion} && nvm alias default ${nodeVersion}`,
      1_200_000
    )
  }

  async installGlobalPackage(pkg: string): Promise<ToolsCommandResult> {
    return runBash(`${NVM_SOURCE}; npm install -g ${pkg}`, 300_000)
  }
}

interface ToolEnvResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * `NVM_SOURCE`를 source한 bash로 탐지 명령을 실행한다 — 설치(`runBash`)가 보는
 * 것과 동일한 환경. 실행 자체가 안 되거나(ENOENT 등) 타임아웃 나도 조용히
 * 실패로 돌린다(호출부가 각자 빈 결과/false로 해석).
 */
async function runInToolEnv(cmd: string, timeoutMs = 20_000): Promise<ToolEnvResult> {
  return run(['bash', '-c', `${NVM_SOURCE}; ${cmd}`], timeoutMs)
}

async function runBash(cmd: string, timeoutMs: number): Promise<ToolsCommandResult> {
  const result = await run(['bash', '-c', cmd], timeoutMs)
  const output = (result.stdout + result.stderr).slice(-2000)
  if (result.code !== 0) {
    return { ok: false, output }
  }
  return { ok: true, output }
}
