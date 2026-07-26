/**
 * LinuxToolsProvider 탐지 — 실사용 버그 회귀 테스트: GUI로 뜬 Electron 앱의
 * PATH엔 nvm이 없어(`nvm.sh`를 source한 적이 없는 non-login 프로세스) 탐지가
 * 설치와 다른 환경을 보고 있었다("v25.8.1 is already installed"가 찍히는데
 * diff는 여전히 미설치로 보던 문제). `spawnSync`를 fake exec로 모킹해 탐지
 * 명령이 실제로 `NVM_SOURCE`를 source한 bash에서 실행되는지, 그리고 nvm이
 * 없는 머신에서도 조용히(에러 없이) 빈 결과로 폴백하는지 확인한다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NVM_SOURCE } from '../../capabilities/tools/constants'

const spawnSyncMock = vi.fn()

vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args)
}))

// vi.mock 뒤에 import해야 모킹된 spawnSync를 쓴다.
const { LinuxToolsProvider } = await import('./tools')

function commandOf(call: unknown[]): string {
  // spawnSync('bash', ['-c', cmd], opts) 호출 형태를 가정.
  const argv = call[1] as string[]
  return argv[1]
}

beforeEach(() => {
  spawnSyncMock.mockReset()
})

describe('LinuxToolsProvider — nvm 소싱 후 탐지 (환경 정합성)', () => {
  it('nodeVersion()이 NVM_SOURCE를 source한 bash로 node --version을 실행한다', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: 'v25.8.1\n', stderr: '', error: undefined })
    const provider = new LinuxToolsProvider()

    const version = provider.nodeVersion()

    expect(version).toBe('v25.8.1')
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
    const [cmd, argv] = spawnSyncMock.mock.calls[0] as [string, string[]]
    expect(cmd).toBe('bash')
    expect(argv[0]).toBe('-c')
    expect(argv[1]).toContain(NVM_SOURCE)
    expect(argv[1]).toContain('node --version')
  })

  it('npmGlobals()도 같은 NVM_SOURCE 환경에서 npm ls -g --json을 실행하고 파싱한다', () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        dependencies: { pnpm: { version: '10.0.0' }, npm: { version: '11' } }
      }),
      stderr: '',
      error: undefined
    })
    const provider = new LinuxToolsProvider()

    const globals = provider.npmGlobals()

    expect(globals).toEqual({ pnpm: '10.0.0' })
    const [, argv] = spawnSyncMock.mock.calls[0] as [string, string[]]
    expect(argv[1]).toContain(NVM_SOURCE)
    expect(argv[1]).toContain('npm ls -g')
  })

  it('npmNodeAvailable()이 nvm 환경에서 node/npm이 실제로 발견되면 true', () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '', error: undefined })
    const provider = new LinuxToolsProvider()
    expect(provider.npmNodeAvailable()).toBe(true)
    expect(commandOf(spawnSyncMock.mock.calls[0])).toContain(NVM_SOURCE)
  })

  it('nvm이 없는 머신 -- NVM_SOURCE의 source 조건이 no-op돼 PATH에도 없으면 조용히 실패로 폴백', () => {
    // 실제 bash에서 nvm.sh가 없으면 NVM_SOURCE의 `&&`가 조용히 실패하고,
    // 이어지는 `node --version`이 PATH에도 없으면 "command not found"로
    // 종료코드 127을 낸다. 이 상황을 그대로 흉내낸다 -- 예외를 던지지 않고
    // 빈 결과로 조용히 처리돼야 한다(설치 안 된 머신에서의 정상 상태).
    spawnSyncMock.mockReturnValue({
      status: 127,
      stdout: '',
      stderr: 'bash: node: command not found\n',
      error: undefined
    })
    const provider = new LinuxToolsProvider()

    expect(provider.nodeVersion()).toBe('')
    expect(provider.npmNodeAvailable()).toBe(false)
    expect(provider.npmGlobals()).toEqual({})
  })

  it('spawnSync 자체가 실패(ENOENT 등)해도 던지지 않고 빈 결과로 처리한다', () => {
    spawnSyncMock.mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('spawnSync bash ENOENT')
    })
    const provider = new LinuxToolsProvider()

    expect(() => provider.nodeVersion()).not.toThrow()
    expect(provider.nodeVersion()).toBe('')
    expect(provider.npmNodeAvailable()).toBe(false)
  })
})
