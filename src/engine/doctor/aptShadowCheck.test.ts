import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../testFixtures'
import { writeCommonAptSection } from '../capabilities/packages/io'
import { makeFakeAptProvider } from '../capabilities/packages/testHelpers'
import { checkAptShadowing } from './aptShadowCheck'

// 실증 사례 재발 방지(2026-07-27)의 Doctor 쪽 자매 검사 — planApt의 사전
// 경고(apt.test.ts의 "non-dpkg conflict pre-warning")는 "설치 전" 시점을
// 보고, 이 검사는 "이미 관리 중인 패키지가 계속 가려지고 있는" 상시 상태를
// 본다. pathDirs를 3번째 인자로 직접 주입해 process.env.PATH에 기대지 않는다.

describe('checkAptShadowing', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('warns when a dpkg-unowned executable earlier on PATH shadows the dpkg-owned managed package', () => {
    writeCommonAptSection(fixture.ctx, { packages: ['rclone'] })
    const provider = makeFakeAptProvider({
      files: {
        '/usr/local/bin/rclone': 'ELF-unmanaged',
        '/usr/bin/rclone': 'ELF-dpkg'
      },
      dpkgOwnedPaths: ['/usr/bin/rclone']
    })

    const result = checkAptShadowing(fixture.ctx, provider, ['/usr/local/bin', '/usr/bin'])

    expect(result.findings).toEqual([
      {
        packageName: 'rclone',
        shadowingPath: '/usr/local/bin/rclone',
        dpkgOwnedPath: '/usr/bin/rclone',
        resolveCommand: 'sudo rm /usr/local/bin/rclone'
      }
    ])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('rclone')
    expect(result.warnings[0]).toContain('/usr/local/bin/rclone')
    expect(result.warnings[0]).toContain('/usr/bin/rclone')
  })

  it('is silent when the dpkg-owned executable is the first PATH hit (normal case)', () => {
    writeCommonAptSection(fixture.ctx, { packages: ['git'] })
    const provider = makeFakeAptProvider({
      files: { '/usr/bin/git': 'ELF-dpkg' },
      dpkgOwnedPaths: ['/usr/bin/git']
    })

    const result = checkAptShadowing(fixture.ctx, provider, ['/usr/local/bin', '/usr/bin'])

    expect(result.findings).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('does not inspect a package outside the managed (manifest) list even if it would otherwise be shadowed', () => {
    // wget이 설치돼 있고 가려지고 있어도, manifest에 선언(managed)돼 있지
    // 않으면 이 검사의 대상이 아니다 -- planApt 쪽(설치 전 경고)의 몫이다.
    writeCommonAptSection(fixture.ctx, { packages: ['git'] })
    const provider = makeFakeAptProvider({
      files: {
        '/usr/local/bin/wget': 'ELF-unmanaged',
        '/usr/bin/wget': 'ELF-dpkg',
        '/usr/bin/git': 'ELF-dpkg'
      },
      dpkgOwnedPaths: ['/usr/bin/wget', '/usr/bin/git']
    })

    const result = checkAptShadowing(fixture.ctx, provider, ['/usr/local/bin', '/usr/bin'])

    expect(result.findings).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('reports nothing when apt is unavailable on this machine', () => {
    writeCommonAptSection(fixture.ctx, { packages: ['git'] })
    const provider = makeFakeAptProvider({ available: false })

    const result = checkAptShadowing(fixture.ctx, provider, ['/usr/local/bin', '/usr/bin'])

    expect(result.findings).toEqual([])
    expect(result.warnings).toEqual([])
  })
})
