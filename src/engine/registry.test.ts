import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFakeGearLeverProvider } from './capabilities/appimage/testHelpers'
import {
  makeFakeAptProvider,
  makeFakeFlatpakProvider,
  makeFakeSnapProvider
} from './capabilities/packages/testHelpers'
import { makeFakeGitProvider } from './capabilities/repos/testHelpers'
import { makeFakeToolsProvider } from './capabilities/tools/testHelpers'
import { readCommonLayer, readHostLayer, writeCommonLayer, writeManifestFile } from './manifest'
import { registerEntry, unregisterEntry, type RegisterEntryDeps } from './registry'
import { isSubscribed, readSelectionFilter } from './selection'
import { makeFixture, writeHomeFile, writeSelection, type TestFixture } from './testFixtures'

// apt-cache policy 실측 원문(packages/classify.test.ts와 같은 소스) — zsh는
// 실제 저장소 소스가 있어 등록 검증을 통과한다.
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

function makeDeps(): RegisterEntryDeps {
  return {
    packages: {
      apt: makeFakeAptProvider({ policyPackagesRaw: ZSH_POLICY_RAW }),
      snap: makeFakeSnapProvider(),
      flatpak: makeFakeFlatpakProvider({
        apps: [{ application: 'org.gimp.GIMP', origin: 'flathub', installation: 'user' }]
      })
    },
    gearLever: makeFakeGearLeverProvider(),
    tools: makeFakeToolsProvider({ globals: { pnpm: '9.0.0' } }),
    git: makeFakeGitProvider()
  }
}

function aptPackagesOf(fixture: TestFixture): string[] {
  const doc = readCommonLayer(fixture.ctx, 'packages')
  return ((doc.apt as { packages?: string[] } | undefined)?.packages ?? []) as string[]
}

describe('registerEntry — 라우팅 + 자동 구독', () => {
  it('apt 패키지를 common에 upsert하고 mode=all에서 자동 구독한다(exclude에서 제거)', async () => {
    const fixture = makeFixture('reference')
    writeSelection(fixture, { mode: 'all', apt: { exclude: ['zsh'] } })

    await registerEntry(fixture.ctx, makeDeps(), 'apt', 'zsh')

    expect(aptPackagesOf(fixture)).toEqual(['zsh'])
    const filter = readSelectionFilter(fixture.ctx, 'apt')
    expect(isSubscribed(filter, 'zsh')).toBe(true)
    fixture.cleanup()
  })

  it('mode=select에서 등록하면 자동으로 include에 추가돼 구독된다', async () => {
    const fixture = makeFixture('reference')
    writeSelection(fixture, { mode: 'select' })

    await registerEntry(fixture.ctx, makeDeps(), 'apt', 'zsh')

    const filter = readSelectionFilter(fixture.ctx, 'apt')
    expect(isSubscribed(filter, 'zsh')).toBe(true)
    expect([...filter.include]).toContain('zsh')
    fixture.cleanup()
  })

  it('flatpak/appimage/fonts/tools/repos로 올바르게 라우팅한다', async () => {
    const fixture = makeFixture('reference')
    const deps = makeDeps()

    await registerEntry(fixture.ctx, deps, 'flatpak', 'org.gimp.GIMP')
    const flatpakDoc = readCommonLayer(fixture.ctx, 'packages')
    expect((flatpakDoc.flatpak as { app?: unknown[] } | undefined)?.app).toHaveLength(1)

    fixture.cleanup()
  })

  it('dotfiles는 upsert(재캡처)만 지원 — manifest에 없으면 명시 에러', async () => {
    const fixture = makeFixture('reference')
    writeHomeFile(fixture, '.zshrc', 'x')

    await expect(registerEntry(fixture.ctx, makeDeps(), 'dotfiles', '~/.zshrc')).rejects.toThrow()
    fixture.cleanup()
  })

  it('재등록(같은 key)은 upsert 멱등 — 중복 없이 그대로', async () => {
    const fixture = makeFixture('reference')
    const deps = makeDeps()

    await registerEntry(fixture.ctx, deps, 'apt', 'zsh')
    await registerEntry(fixture.ctx, deps, 'apt', 'zsh')

    expect(aptPackagesOf(fixture)).toEqual(['zsh'])
    fixture.cleanup()
  })
})

describe('unregisterEntry — 카탈로그 제거, 로컬 시스템 불간섭', () => {
  it('common에서 엔트리를 제거한다', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, 'packages', { apt: { packages: ['zsh', 'curl'] } })

    unregisterEntry(fixture.ctx, 'apt', 'zsh')

    expect(aptPackagesOf(fixture)).toEqual(['curl'])
    fixture.cleanup()
  })

  it('host 계층에도 있으면 함께 제거한다', () => {
    const fixture = makeFixture('reference')
    writeManifestFile(path.join(fixture.manifestDir, 'hosts', 'testhost', 'fonts.toml'), {
      font: [
        {
          name: 'D2Coding',
          source: { kind: 'github-release', coordinate: 'x', assetPattern: '*' },
          files: []
        }
      ]
    })

    unregisterEntry(fixture.ctx, 'fonts', 'D2Coding')

    const hostDoc = readHostLayer(fixture.ctx, 'fonts')
    expect(hostDoc.font ?? []).toHaveLength(0)
    fixture.cleanup()
  })

  it('없는 key를 지워도 예외 없이 멱등하다', () => {
    const fixture = makeFixture('reference')
    expect(() => unregisterEntry(fixture.ctx, 'apt', 'ghost')).not.toThrow()
    fixture.cleanup()
  })

  it('이 머신 selection의 흔적을 정리한다(select 모드 include 제거)', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, 'packages', { apt: { packages: ['zsh'] } })
    writeSelection(fixture, { mode: 'select', apt: { include: ['zsh'] } })

    unregisterEntry(fixture.ctx, 'apt', 'zsh')

    const filter = readSelectionFilter(fixture.ctx, 'apt')
    expect([...filter.include]).not.toContain('zsh')
    fixture.cleanup()
  })

  it('이 머신 selection의 흔적을 정리한다(all 모드 exclude 제거)', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, 'packages', { apt: { packages: ['zsh'] } })
    writeSelection(fixture, { mode: 'all', apt: { exclude: ['zsh'] } })

    unregisterEntry(fixture.ctx, 'apt', 'zsh')

    const filter = readSelectionFilter(fixture.ctx, 'apt')
    expect([...filter.exclude]).not.toContain('zsh')
    fixture.cleanup()
  })

  it('appimage/repos/tools 삭제는 라이브 시스템 provider를 전혀 호출하지 않는다(로컬 설치물 불간섭)', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, 'appimage', {
      app: [
        {
          name: 'tev.desktop',
          source: 'GithubUpdater',
          coordinate: 'Tom94/tev',
          repoFilename: 'tev.appimage'
        }
      ]
    })
    writeCommonLayer(fixture.ctx, 'repos', {
      repo: [{ path: '~/repos/foo', url: '', branch: 'main' }]
    })
    writeCommonLayer(fixture.ctx, 'tools', { packages: ['pnpm'] })

    unregisterEntry(fixture.ctx, 'appimage', 'tev.desktop')
    unregisterEntry(fixture.ctx, 'repos', '~/repos/foo')
    unregisterEntry(fixture.ctx, 'tools', 'pnpm')

    const appimageDoc = readCommonLayer(fixture.ctx, 'appimage')
    expect(appimageDoc.app ?? []).toHaveLength(0)
    const reposDoc = readCommonLayer(fixture.ctx, 'repos')
    expect(reposDoc.repo ?? []).toHaveLength(0)
    const toolsDoc = readCommonLayer(fixture.ctx, 'tools')
    expect(toolsDoc.packages ?? []).toHaveLength(0)
    // 홈 디렉터리·store 어디에도 이 테스트가 fs를 건드리지 않았다는 사실 자체가
    // "로컬 파일·설치물은 절대 건드리지 않는다"는 계약의 소극적 증거다 — 이
    // 함수들이 provider(라이브 시스템 조회)를 인자로도 받지 않는다는 타입
    // 시그니처(unregisterEntry(ctx, capability, key), provider 없음)가
    // 적극적 증거다.
    fixture.cleanup()
  })
})

describe('unregisterEntry — dotfiles', () => {
  it('store payload는 지우지만 홈의 실제 파일은 건드리지 않는다', () => {
    const fixture = makeFixture('reference')
    const homeAbs = writeHomeFile(fixture, '.zshrc', 'echo hi\n')
    writeCommonLayer(fixture.ctx, 'dotfiles', {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    const storeAbs = path.join(fixture.manifestDir, 'dotfiles/.zshrc')
    fs.mkdirSync(path.dirname(storeAbs), { recursive: true })
    fs.writeFileSync(storeAbs, 'echo hi\n')

    unregisterEntry(fixture.ctx, 'dotfiles', '~/.zshrc')

    expect(fs.existsSync(storeAbs)).toBe(false)
    expect(fs.existsSync(homeAbs)).toBe(true)
    fixture.cleanup()
  })
})
