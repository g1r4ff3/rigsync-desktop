import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { readCommonPackages } from './io'
import {
  AptRepositoryNotFoundError,
  FlatpakAppNotInstalledError,
  registerAptPackage,
  registerFlatpakApp
} from './register'
import { makeFakeAptProvider, makeFakeFlatpakProvider } from './testHelpers'

// apt-cache policy 실측 원문(classify.test.ts POLICY_PACKAGES_RAW와 같은 소스,
// 2026-07-27 이 머신 실측) — zsh는 Ubuntu 저장소 소스가 있고, claude-desktop은
// dpkg status뿐(로컬 .deb로 수동 설치, 선례: gcm·rustdesk 부류).
const ZSH_POLICY_RAW = [
  'zsh:',
  '  Installed: 5.9-6ubuntu2',
  '  Candidate: 5.9-6ubuntu2',
  '  Version table:',
  ' *** 5.9-6ubuntu2 500',
  '        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages',
  '        100 /var/lib/dpkg/status',
  ''
].join('\n')

const CLAUDE_DESKTOP_POLICY_RAW = [
  'claude-desktop:',
  '  Installed: 1.24012.9',
  '  Candidate: 1.24012.9',
  '  Version table:',
  ' *** 1.24012.9 100',
  '        100 /var/lib/dpkg/status',
  ''
].join('\n')

describe('registerAptPackage', () => {
  it('저장소 출처가 있으면 common packages.toml에 upsert한다', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeAptProvider({ policyPackagesRaw: ZSH_POLICY_RAW })

    await registerAptPackage(fixture.ctx, provider, 'zsh')

    expect(readCommonPackages(fixture.ctx).apt?.packages).toEqual(['zsh'])
    fixture.cleanup()
  })

  it('저장소 출처가 dpkg status뿐이면(로컬 .deb) 거부한다', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeAptProvider({ policyPackagesRaw: CLAUDE_DESKTOP_POLICY_RAW })

    await expect(registerAptPackage(fixture.ctx, provider, 'claude-desktop')).rejects.toThrow(
      AptRepositoryNotFoundError
    )
    expect(readCommonPackages(fixture.ctx).apt?.packages ?? []).toHaveLength(0)
    fixture.cleanup()
  })

  it('policy 원문에 아예 없는 이름(candidate 없음)도 거부한다', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeAptProvider({ policyPackagesRaw: '' })

    await expect(registerAptPackage(fixture.ctx, provider, 'ghost-pkg')).rejects.toThrow(
      AptRepositoryNotFoundError
    )
    fixture.cleanup()
  })

  it('이미 등록된 패키지는 재등록해도 멱등(중복 없이 그대로)', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeAptProvider({ policyPackagesRaw: ZSH_POLICY_RAW })

    await registerAptPackage(fixture.ctx, provider, 'zsh')
    await registerAptPackage(fixture.ctx, provider, 'zsh')

    expect(readCommonPackages(fixture.ctx).apt?.packages).toEqual(['zsh'])
    fixture.cleanup()
  })
})

describe('registerFlatpakApp', () => {
  it('설치된 앱의 origin을 그대로 읽어 upsert한다', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeFlatpakProvider({
      apps: [{ application: 'org.gimp.GIMP', origin: 'flathub', installation: 'user' }]
    })

    await registerFlatpakApp(fixture.ctx, provider, 'org.gimp.GIMP')

    expect(readCommonPackages(fixture.ctx).flatpak?.app).toEqual([
      { application: 'org.gimp.GIMP', origin: 'flathub', installation: 'user' }
    ])
    fixture.cleanup()
  })

  it('이 머신에 설치돼 있지 않으면 거부한다', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeFlatpakProvider({ apps: [] })

    await expect(registerFlatpakApp(fixture.ctx, provider, 'org.gimp.GIMP')).rejects.toThrow(
      FlatpakAppNotInstalledError
    )
    fixture.cleanup()
  })

  it('이미 등록된 app을 재등록하면 최신 origin으로 갱신한다(upsert)', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeFlatpakProvider({
      apps: [{ application: 'org.gimp.GIMP', origin: 'flathub-beta', installation: 'user' }]
    })

    await registerFlatpakApp(fixture.ctx, provider, 'org.gimp.GIMP')
    await registerFlatpakApp(fixture.ctx, provider, 'org.gimp.GIMP')

    expect(readCommonPackages(fixture.ctx).flatpak?.app).toEqual([
      { application: 'org.gimp.GIMP', origin: 'flathub-beta', installation: 'user' }
    ])
    fixture.cleanup()
  })
})
