import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, writeIgnore, type TestFixture } from '../../testFixtures'
import { buildPackageSyncGroups } from './candidates'
import { captureApt } from './apt'
import { writeAptBaseline } from './aptBaseline'
import { makeFakeAptProvider, makeFakeFlatpakProvider, makeFakeSnapProvider } from './testHelpers'

// 신규 테스트 (구 repo엔 이 화면이 없었음) — P2a 결정 ⑤ "동기화 항목" 화면의
// 데이터 소스. 관건: diff와 달리 ignore된 항목도 **보여야** 한다(토글 대상이므로).

describe('buildPackageSyncGroups', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('groups managed + unmanaged items per provider, marking ignored ones (not hiding them)', async () => {
    writeAptBaseline(fixture.ctx, []) // P2c: baseline 없으면 첫 capture가 스냅샷만 하고 끝난다
    const aptProvider = makeFakeAptProvider({ manual: ['git'] })
    await captureApt(fixture.ctx, aptProvider, { dryRun: false }) // "git" becomes managed

    writeIgnore(fixture, { apt: { packages: ['zoom'], sources: [] } })

    // 지금 시점엔 git(manifested) + curl(설치돼 있으나 미기록) + zoom(설치돼 있고 ignore됨)
    const laterApt = makeFakeAptProvider({ manual: ['git', 'curl', 'zoom'] })
    const snap = makeFakeSnapProvider([])
    const flatpak = makeFakeFlatpakProvider()

    const groups = await buildPackageSyncGroups(fixture.ctx, {
      apt: laterApt,
      snap,
      flatpak
    })

    const aptGroup = groups.find((g) => g.capability === 'apt')
    expect(aptGroup).toBeDefined()
    const byKey = new Map(aptGroup!.items.map((i) => [i.key, i]))

    expect(byKey.get('git')).toEqual({ key: 'git', label: 'git', managed: true, ignored: false })
    expect(byKey.get('curl')).toEqual({
      key: 'curl',
      label: 'curl',
      managed: false,
      ignored: false
    })
    // ignore된 항목도 화면엔 나타나야 한다 (diff와 다르게 숨기지 않는다).
    expect(byKey.get('zoom')).toEqual({ key: 'zoom', label: 'zoom', managed: false, ignored: true })
  })

  it('omits a provider group entirely when it has no items', async () => {
    const groups = await buildPackageSyncGroups(fixture.ctx, {
      apt: makeFakeAptProvider({ available: false }),
      snap: makeFakeSnapProvider([], false),
      flatpak: makeFakeFlatpakProvider({ available: false })
    })
    expect(groups).toEqual([])
  })

  // R6 R2: apt-cache show 배치 조회 -- 이름 전부를 한 번에 넘기고, 사전에
  // 없는 이름은 description이 undefined로 조용히 빠진다(에러로 화면을 막지 않는다).
  it('attaches an apt description when the provider has one, omitting it otherwise', async () => {
    const aptProvider = makeFakeAptProvider({
      manual: ['git', 'some-unknown-pkg'],
      descriptions: { git: 'fast, scalable, distributed revision control system' }
    })
    const groups = await buildPackageSyncGroups(fixture.ctx, {
      apt: aptProvider,
      snap: makeFakeSnapProvider([]),
      flatpak: makeFakeFlatpakProvider()
    })
    const byKey = new Map(groups.find((g) => g.capability === 'apt')!.items.map((i) => [i.key, i]))
    expect(byKey.get('git')?.description).toBe(
      'fast, scalable, distributed revision control system'
    )
    expect(byKey.get('some-unknown-pkg')?.description).toBeUndefined()
  })

  // R6 R2: flatpak list --columns=application,name,description은 이름+설명이
  // 함께 나온다 -- 한 줄로 합쳐서 보여준다(설명이 없으면 이름만).
  it('combines flatpak name+description into a one-line description', async () => {
    const flatpak = makeFakeFlatpakProvider({
      apps: [{ application: 'com.obsproject.Studio', origin: 'flathub', installation: 'user' }],
      details: {
        'com.obsproject.Studio': {
          name: 'OBS Studio',
          description: 'Live stream and record videos'
        }
      }
    })
    const groups = await buildPackageSyncGroups(fixture.ctx, {
      apt: makeFakeAptProvider({ available: false }),
      snap: makeFakeSnapProvider([], false),
      flatpak
    })
    const item = groups.find((g) => g.capability === 'flatpak')!.items[0]
    expect(item.description).toBe('OBS Studio — Live stream and record videos')
  })

  it('falls back to just the flatpak name when there is no description text', async () => {
    const flatpak = makeFakeFlatpakProvider({
      apps: [{ application: 'it.mijorus.gearlever', origin: 'flathub', installation: 'user' }],
      details: { 'it.mijorus.gearlever': { name: 'Gear Lever', description: '' } }
    })
    const groups = await buildPackageSyncGroups(fixture.ctx, {
      apt: makeFakeAptProvider({ available: false }),
      snap: makeFakeSnapProvider([], false),
      flatpak
    })
    const item = groups.find((g) => g.capability === 'flatpak')!.items[0]
    expect(item.description).toBe('Gear Lever')
  })
})
