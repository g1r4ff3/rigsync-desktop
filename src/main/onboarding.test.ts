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
import { readSelectionMode } from '../engine/selection'
import { makeFixture, type TestFixture } from '../engine/testFixtures'
import { makeFakeGitTransportProvider } from '../engine/transport/testHelpers'
import { applyOnboardingSelectionMode, completeOnboarding } from './onboarding'
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

// WS7("창고 모델 1차"): 온보딩 구독 모드 스텝 — completeOnboarding(config.toml
// 저장) 뒤에 호출하는 별도 단계.
describe('applyOnboardingSelectionMode', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it("selectionMode='select'면 이 머신 selection.toml에 mode='select'를 즉시 쓴다(로컬 fs 쓰기는 git 상태와 무관)", () => {
    const gitTransportProvider = makeFakeGitTransportProvider() // isGitRepo=false 기본 -- manifestSource='new'와 동등.
    applyOnboardingSelectionMode(fixture.ctx, 'select', gitTransportProvider)
    expect(readSelectionMode(fixture.ctx)).toBe('select')
  })

  it("selectionMode='all'(또는 생략)이면 아무 것도 쓰지 않는다 -- 파일 부재=all 무마이그레이션 계약 유지", () => {
    const gitTransportProvider = makeFakeGitTransportProvider()
    applyOnboardingSelectionMode(fixture.ctx, 'all', gitTransportProvider)
    applyOnboardingSelectionMode(fixture.ctx, undefined, gitTransportProvider)
    const selectionPath = path.join(
      fixture.manifestDir,
      'hosts',
      fixture.ctx.machineId,
      'selection.toml'
    )
    expect(fs.existsSync(selectionPath)).toBe(false)
    expect(readSelectionMode(fixture.ctx)).toBe('all')
  })

  it('git repo가 아직 없어도(manifestSource=new 상당) 던지지 않는다 -- fire-and-forget push는 local-only로 조용히 끝난다', () => {
    const gitTransportProvider = makeFakeGitTransportProvider({ isGitRepo: false })
    expect(() =>
      applyOnboardingSelectionMode(fixture.ctx, 'select', gitTransportProvider)
    ).not.toThrow()
    expect(readSelectionMode(fixture.ctx)).toBe('select')
  })
})
