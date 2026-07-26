/**
 * 실사용 결함 수정 검증 -- 온보딩 "저장소에서 클론"(`manifestSource:'clone'`).
 * 클론이 성공하면 config.toml이 쓰이고, 실패하면 **config를 쓰지 않고
 * 예외를 던져** 온보딩이 그대로 머물게 한다(OnboardingView의 catch가 폼에
 * 남아있게 함 — App.tsx는 onComplete를 호출하지 않는다).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfigPath } from '../engine/context'
import { makeFakeGitTransportProvider } from '../engine/transport/testHelpers'
import { completeOnboarding } from './onboarding'
import type { CompleteOnboardingRequest } from '../shared/ipc'

describe('completeOnboarding — manifestSource: clone', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-onboarding-'))
  })

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  const baseRequest: Omit<CompleteOnboardingRequest, 'manifestSource' | 'repoUrl'> = {
    machineId: 'follower-host',
    role: 'follower',
    manifestDir: '~/manifest',
    autostartEnabled: false
  }

  it('writes config.toml after a successful clone', async () => {
    const gitTransportProvider = makeFakeGitTransportProvider({
      cloneResult: { ok: true, output: '' }
    })
    await completeOnboarding(
      { ...baseRequest, manifestSource: 'clone', repoUrl: 'https://example/repo.git' },
      { homeDir, execPath: '/usr/bin/rigsync-desktop', isDev: true, gitTransportProvider }
    )
    expect(fs.existsSync(defaultConfigPath(homeDir))).toBe(true)
  })

  it('does not write config.toml and throws a human-readable error when the clone fails', async () => {
    const gitTransportProvider = makeFakeGitTransportProvider({
      cloneResult: {
        ok: false,
        output: 'fatal: Authentication failed for https://example/repo.git'
      }
    })
    await expect(
      completeOnboarding(
        { ...baseRequest, manifestSource: 'clone', repoUrl: 'https://example/repo.git' },
        { homeDir, execPath: '/usr/bin/rigsync-desktop', isDev: true, gitTransportProvider }
      )
    ).rejects.toThrow(/gh auth login/)
    expect(fs.existsSync(defaultConfigPath(homeDir))).toBe(false)
  })

  it('throws without writing config.toml when repoUrl is missing', async () => {
    const gitTransportProvider = makeFakeGitTransportProvider()
    await expect(
      completeOnboarding(
        { ...baseRequest, manifestSource: 'clone', repoUrl: '   ' },
        { homeDir, execPath: '/usr/bin/rigsync-desktop', isDev: true, gitTransportProvider }
      )
    ).rejects.toThrow('저장소 URL을 입력하세요')
    expect(fs.existsSync(defaultConfigPath(homeDir))).toBe(false)
  })

  it('still supports manifestSource "new" (mkdir -p, unaffected by the clone change)', async () => {
    const gitTransportProvider = makeFakeGitTransportProvider()
    await completeOnboarding(
      { ...baseRequest, role: 'reference', manifestSource: 'new' },
      { homeDir, execPath: '/usr/bin/rigsync-desktop', isDev: true, gitTransportProvider }
    )
    expect(fs.existsSync(defaultConfigPath(homeDir))).toBe(true)
    expect(fs.existsSync(path.join(homeDir, 'manifest'))).toBe(true)
  })
})
