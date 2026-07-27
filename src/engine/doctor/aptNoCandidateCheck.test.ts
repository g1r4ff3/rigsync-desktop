import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../testFixtures'
import { writeCommonAptSection } from '../capabilities/packages/io'
import { makeFakeAptProvider } from '../capabilities/packages/testHelpers'
import { checkAptNoCandidate } from './aptNoCandidateCheck'

// 실사용 사고 재발 방지(2026-07-27): 저장소 없는 로컬 .deb(gcm·rustdesk)가 apt
// 관리 목록에 들어가 follower Apply가 "Unable to locate package"로 실패했다.
// `apt-cache policy` 원문을 배치 1회로 흉내내 세 경우(정상/로컬 .deb/완전
// 미지의 이름)를 구분한다.

describe('checkAptNoCandidate', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('is silent when every managed package has a real repository candidate', async () => {
    writeCommonAptSection(fixture.ctx, { packages: ['curl'] })
    const provider = makeFakeAptProvider({
      policyPackagesRaw: [
        'curl:',
        '  Installed: 8.5.0-2ubuntu10.6',
        '  Candidate: 8.5.0-2ubuntu10.6',
        '  Version table:',
        ' *** 8.5.0-2ubuntu10.6 500',
        '        500 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages'
      ].join('\n')
    })

    const result = await checkAptNoCandidate(fixture.ctx, provider)

    expect(result.findings).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('warns when a managed package is installed only from dpkg status (local .deb, real-world gcm/rustdesk incident)', async () => {
    writeCommonAptSection(fixture.ctx, { packages: ['gcm'] })
    const provider = makeFakeAptProvider({
      policyPackagesRaw: [
        'gcm:',
        '  Installed: 2.6.1-0',
        '  Candidate: (none)',
        '  Version table:',
        ' *** 2.6.1-0 100',
        '        100 /var/lib/dpkg/status'
      ].join('\n')
    })

    const result = await checkAptNoCandidate(fixture.ctx, provider)

    expect(result.findings).toEqual([{ packageName: 'gcm' }])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('gcm')
    expect(result.warnings[0]).toContain('어떤 저장소도')
    expect(result.warnings[0]).toContain('follower Apply')
  })

  it('warns when a managed package is not installed and apt-cache does not even recognize the name', async () => {
    // apt-cache policy가 이름을 아예 모르면(오타·삭제된 패키지 등) stdout에
    // 그 이름의 스탠자 자체가 없다 -- stderr("Unable to locate package")는
    // provider.policyPackagesRaw가 애초에 stdout만 돌려주므로 여기 안 섞인다.
    writeCommonAptSection(fixture.ctx, { packages: ['ghost-package'] })
    const provider = makeFakeAptProvider({ policyPackagesRaw: '' })

    const result = await checkAptNoCandidate(fixture.ctx, provider)

    expect(result.findings).toEqual([{ packageName: 'ghost-package' }])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('ghost-package')
  })

  it('checks each managed package independently in a mixed batch', async () => {
    writeCommonAptSection(fixture.ctx, { packages: ['curl', 'gcm'] })
    const provider = makeFakeAptProvider({
      policyPackagesRaw: [
        'curl:',
        '  Installed: 8.5.0-2ubuntu10.6',
        '  Candidate: 8.5.0-2ubuntu10.6',
        '  Version table:',
        ' *** 8.5.0-2ubuntu10.6 500',
        '        500 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages',
        'gcm:',
        '  Installed: 2.6.1-0',
        '  Candidate: (none)',
        '  Version table:',
        ' *** 2.6.1-0 100',
        '        100 /var/lib/dpkg/status'
      ].join('\n')
    })

    const result = await checkAptNoCandidate(fixture.ctx, provider)

    expect(result.findings).toEqual([{ packageName: 'gcm' }])
  })

  it('reports nothing when apt is unavailable on this machine', async () => {
    writeCommonAptSection(fixture.ctx, { packages: ['gcm'] })
    const provider = makeFakeAptProvider({ available: false })

    const result = await checkAptNoCandidate(fixture.ctx, provider)

    expect(result.findings).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('reports nothing when there are no managed apt packages at all', async () => {
    const provider = makeFakeAptProvider({})

    const result = await checkAptNoCandidate(fixture.ctx, provider)

    expect(result.findings).toEqual([])
    expect(result.warnings).toEqual([])
  })
})
