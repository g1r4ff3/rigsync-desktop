import { afterEach, describe, expect, it } from 'vitest'
import { makeFixture, writeProfileLayer, type TestFixture } from '../testFixtures'
import { effectiveLayer, writeCommonLayer, writeManifestFile, hostLayerPath } from './index'

// 신규 테스트 — FORWARD.md §7 "profiles 계층" (common → profile → host 3단
// 병합). 구 repo엔 profile 개념이 없었다(host 오버레이 2단뿐)라 이식 대상이
// 없다 — mergeLayer 자체(P1에서 이식된 merge_layer 행동)는 그대로 재사용하고,
// effectiveLayer가 그걸 두 번 접어 3단을 만드는 새 배선만 검증한다.

describe('effectiveLayer (common -> profile -> host)', () => {
  let fixture: TestFixture

  afterEach(() => {
    fixture.cleanup()
  })

  it('skips the profile stage entirely when ctx.profile is unset (backward compatible 2-tier)', () => {
    fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, 'packages', { apt: { packages: ['git'] } })
    writeManifestFile(hostLayerPath(fixture.ctx, 'packages'), { apt: { packages: ['zoom'] } })

    const doc = effectiveLayer(fixture.ctx, 'packages') as { apt: { packages: string[] } }
    expect(doc.apt.packages).toEqual(['git', 'zoom'])
  })

  it('profile overlay adds onto common (union for plain arrays)', () => {
    fixture = makeFixture('reference', { profile: 'workstation' })
    writeCommonLayer(fixture.ctx, 'packages', { apt: { packages: ['git'] } })
    writeProfileLayer(fixture, 'workstation', 'packages', {
      apt: { packages: ['nvidia-cuda-toolkit'] }
    })

    const doc = effectiveLayer(fixture.ctx, 'packages') as { apt: { packages: string[] } }
    expect(doc.apt.packages).toEqual(['git', 'nvidia-cuda-toolkit'])
  })

  it('host overlay wins over profile for the same scalar key, and both layer on top of common', () => {
    fixture = makeFixture('reference', { profile: 'workstation' })
    writeCommonLayer(fixture.ctx, 'settings', { theme: 'common-theme', region: 'common-region' })
    writeProfileLayer(fixture, 'workstation', 'settings', { theme: 'profile-theme' })
    writeManifestFile(hostLayerPath(fixture.ctx, 'settings'), { theme: 'host-theme' })

    const doc = effectiveLayer(fixture.ctx, 'settings') as { theme: string; region: string }
    expect(doc.theme).toBe('host-theme') // host가 최종 우선
    expect(doc.region).toBe('common-region') // profile·host 둘 다 안 건드린 키는 common 유지
  })

  it('a profile not present on disk behaves like an empty overlay (no crash, common+host still merge)', () => {
    fixture = makeFixture('reference', { profile: 'laptop' })
    writeCommonLayer(fixture.ctx, 'packages', { apt: { packages: ['git'] } })
    writeManifestFile(hostLayerPath(fixture.ctx, 'packages'), { apt: { packages: ['zoom'] } })

    const doc = effectiveLayer(fixture.ctx, 'packages') as { apt: { packages: string[] } }
    expect(doc.apt.packages).toEqual(['git', 'zoom'])
  })
})
