import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFakeGearLeverProvider } from './capabilities/appimage/testHelpers'
import { captureApt } from './capabilities/packages/apt'
import { writeAptBaseline } from './capabilities/packages/aptBaseline'
import {
  makeFakeAptProvider,
  makeFakeFlatpakProvider,
  makeFakeSnapProvider
} from './capabilities/packages/testHelpers'
import { makeFakeGitProvider } from './capabilities/repos/testHelpers'
import { makeFakeToolsProvider } from './capabilities/tools/testHelpers'
import { readIgnoreSet } from './ignore'
import {
  computeSyncItemState,
  isPendingSyncItemState,
  listSyncItemGroups,
  toggleSyncItemIgnore,
  toggleSyncItemIgnoreBulk,
  withSyncItemState
} from './syncItems'
import { makeFixture, type TestFixture } from './testFixtures'

// R6 R1: 4상태 모델(computeSyncItemState) — managed × ignored 조합이 "다음
// Capture가 오면 무슨 일이 일어나는지"를 코드로 확정한 것(ignore.ts의
// setIgnored 주석 확인 결과: ignore 토글은 manifest를 즉시 바꾸지 않고 다음
// capture 때 반영된다). 순수 함수라 fixture 없이 표만으로 검증한다.
describe('computeSyncItemState', () => {
  it('managed && !ignored -> synced (지금 동기화 대상)', () => {
    expect(computeSyncItemState({ managed: true, ignored: false })).toBe('synced')
  })

  it('!managed && !ignored -> pending-add (다음 Capture가 추가)', () => {
    expect(computeSyncItemState({ managed: false, ignored: false })).toBe('pending-add')
  })

  it('managed && ignored -> pending-remove (다음 Capture가 제거)', () => {
    expect(computeSyncItemState({ managed: true, ignored: true })).toBe('pending-remove')
  })

  it('!managed && ignored -> excluded (안정적으로 빠진 상태)', () => {
    expect(computeSyncItemState({ managed: false, ignored: true })).toBe('excluded')
  })
})

describe('isPendingSyncItemState', () => {
  it('is true only for pending-add/pending-remove', () => {
    expect(isPendingSyncItemState('pending-add')).toBe(true)
    expect(isPendingSyncItemState('pending-remove')).toBe(true)
    expect(isPendingSyncItemState('synced')).toBe(false)
    expect(isPendingSyncItemState('excluded')).toBe(false)
  })
})

describe('withSyncItemState', () => {
  it('attaches state to every item without mutating managed/ignored', () => {
    const groups = withSyncItemState([
      {
        capability: 'apt',
        title: 'apt',
        items: [
          { key: 'a', label: 'a', managed: true, ignored: false },
          { key: 'b', label: 'b', managed: false, ignored: false },
          { key: 'c', label: 'c', managed: true, ignored: true },
          { key: 'd', label: 'd', managed: false, ignored: true }
        ]
      }
    ])
    expect(groups[0].items.map((i) => i.state)).toEqual([
      'synced',
      'pending-add',
      'pending-remove',
      'excluded'
    ])
  })

  // R7: 코디네이터 스크린샷 발견 — snap(detectionOnly) 그룹 헤더는 "검출 전용 —
  // 동기화 대상 아님"인데 항목은 4상태 모델을 그대로 태워 "추가 예정"으로
  // 나온 자기모순이 있었다. detectionOnly 그룹은 managed×ignored 조합과
  // 무관하게 전부 'detected' 하나로 나와야 한다.
  it('overrides every state to "detected" for a detectionOnly group, regardless of managed/ignored', () => {
    const groups = withSyncItemState([
      {
        capability: 'snap',
        title: 'snap (검출 전용 — 동기화 대상 아님)',
        detectionOnly: true,
        items: [
          { key: 'a', label: 'a', managed: true, ignored: false },
          { key: 'b', label: 'b', managed: false, ignored: false },
          { key: 'c', label: 'c', managed: true, ignored: true },
          { key: 'd', label: 'd', managed: false, ignored: true }
        ]
      }
    ])
    expect(groups[0].items.map((i) => i.state)).toEqual([
      'detected',
      'detected',
      'detected',
      'detected'
    ])
  })

  it('leaves non-detectionOnly groups on the 4-state model when mixed with a detectionOnly group', () => {
    const groups = withSyncItemState([
      {
        capability: 'apt',
        title: 'apt',
        items: [{ key: 'a', label: 'a', managed: false, ignored: false }]
      },
      {
        capability: 'snap',
        title: 'snap (검출 전용 — 동기화 대상 아님)',
        detectionOnly: true,
        items: [{ key: 'b', label: 'b', managed: false, ignored: false }]
      }
    ])
    expect(groups[0].items[0].state).toBe('pending-add')
    expect(groups[1].items[0].state).toBe('detected')
  })
})

// R6 R1 검증 기준: "Capture 실행 후 이 화면이 갱신되어 '추가 예정'이 '동기화
// 중'으로 바뀌는지 실제로 확인" — 픽스처로 재현한다. 후보(uncaptured)
// 상태였던 패키지가 실제 captureApt() 실행 한 번으로 pending-add -> synced로
// 바뀌는 걸 엔진 레벨에서 end-to-end 증명한다(Candidates 화면은 이 결과를
// 그대로 렌더할 뿐이라, 여기서 증명되면 화면도 옳다).
describe('Capture flips a candidate from pending-add to synced', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('an uncaptured apt package is pending-add before Capture and synced after', async () => {
    writeAptBaseline(fixture.ctx, []) // 첫 capture가 배포판 기본분 스냅샷만 하고 끝나지 않게.
    const aptProvider = makeFakeAptProvider({ manual: ['ripgrep'] })

    const before = await listSyncItemGroups(
      fixture.ctx,
      { apt: aptProvider, snap: makeFakeSnapProvider([]), flatpak: makeFakeFlatpakProvider() },
      makeFakeGearLeverProvider({ available: false }),
      makeFakeToolsProvider({ available: false }),
      makeFakeGitProvider()
    )
    const beforeItem = before
      .find((g) => g.capability === 'apt')!
      .items.find((i) => i.key === 'ripgrep')
    expect(beforeItem?.managed).toBe(false)
    expect(computeSyncItemState(beforeItem!)).toBe('pending-add')

    await captureApt(fixture.ctx, aptProvider, { dryRun: false })

    const after = await listSyncItemGroups(
      fixture.ctx,
      { apt: aptProvider, snap: makeFakeSnapProvider([]), flatpak: makeFakeFlatpakProvider() },
      makeFakeGearLeverProvider({ available: false }),
      makeFakeToolsProvider({ available: false }),
      makeFakeGitProvider()
    )
    const afterItem = after
      .find((g) => g.capability === 'apt')!
      .items.find((i) => i.key === 'ripgrep')
    expect(afterItem?.managed).toBe(true)
    expect(computeSyncItemState(afterItem!)).toBe('synced')
  })
})

describe('listSyncItemGroups / toggleSyncItemIgnore', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('combines dotfiles + package groups, dotfiles first', async () => {
    writeAptBaseline(fixture.ctx, []) // P2c: baseline 없으면 첫 capture가 스냅샷만 하고 끝난다
    const aptProvider = makeFakeAptProvider({ manual: ['git'] })
    await captureApt(fixture.ctx, aptProvider, { dryRun: false })

    const groups = await listSyncItemGroups(
      fixture.ctx,
      {
        apt: aptProvider,
        snap: makeFakeSnapProvider([]),
        flatpak: makeFakeFlatpakProvider()
      },
      makeFakeGearLeverProvider({ available: false }),
      makeFakeToolsProvider({ available: false }),
      makeFakeGitProvider()
    )

    // dotfiles 그룹이 없으면(관리 항목·후보 둘 다 없으면) 생략되고, apt만 남는다.
    expect(groups.map((g) => g.capability)).toEqual(['apt'])
  })

  it('toggling a package item writes common ignore.toml under the right kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'apt', 'zoom', true)
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(new Set(['zoom']))

    toggleSyncItemIgnore(fixture.ctx, 'apt', 'zoom', false)
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(new Set())
  })

  it('toggling a flatpak item writes under the "apps" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'flatpak', 'org.deskflow.deskflow', true)
    expect(readIgnoreSet(fixture.ctx, 'flatpak', 'apps')).toEqual(
      new Set(['org.deskflow.deskflow'])
    )
  })

  it('toggling a dotfiles item writes under the "homes" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'dotfiles', '~/.zshrc', true)
    expect(readIgnoreSet(fixture.ctx, 'dotfiles', 'homes')).toEqual(new Set(['~/.zshrc']))
  })

  it('toggling an appimage item writes under the "names" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'appimage', 'tev.desktop', true)
    expect(readIgnoreSet(fixture.ctx, 'appimage', 'names')).toEqual(new Set(['tev.desktop']))
  })

  it('includes an appimage group when Gear Lever has installed apps', async () => {
    const gearLever = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'tev (2.13.1)',
          path: '/home/cglab/AppImages/tev.appimage',
          desktopId: 'tev.desktop',
          currentVersion: '2.13.1',
          availableVersion: null,
          downloadSize: null,
          manager: 'GithubUpdater',
          embeddedSource: false,
          running: false
        }
      ]
    })
    const groups = await listSyncItemGroups(
      fixture.ctx,
      {
        apt: makeFakeAptProvider({ available: false }),
        snap: makeFakeSnapProvider([], false),
        flatpak: makeFakeFlatpakProvider({ available: false })
      },
      gearLever,
      makeFakeToolsProvider({ available: false }),
      makeFakeGitProvider()
    )
    expect(groups.map((g) => g.capability)).toEqual(['appimage'])
    expect(groups[0].items[0]).toEqual({
      key: 'tev.desktop',
      label: 'tev.desktop',
      managed: false,
      ignored: false,
      // R6 R2: Gear Lever의 listInstalled() name(버전 포함)을 그대로 설명으로 쓴다.
      description: 'tev (2.13.1)'
    })
  })

  it('toggling a tools item writes under the "packages" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'tools', 'claude-mermaid', true)
    expect(readIgnoreSet(fixture.ctx, 'tools', 'packages')).toEqual(new Set(['claude-mermaid']))
  })

  it('toggling a repos item writes under the "paths" kind', () => {
    toggleSyncItemIgnore(fixture.ctx, 'repos', '~/repos/scratch', true)
    expect(readIgnoreSet(fixture.ctx, 'repos', 'paths')).toEqual(new Set(['~/repos/scratch']))
  })

  it('includes a tools group when npm globals are present', async () => {
    const groups = await listSyncItemGroups(
      fixture.ctx,
      {
        apt: makeFakeAptProvider({ available: false }),
        snap: makeFakeSnapProvider([], false),
        flatpak: makeFakeFlatpakProvider({ available: false })
      },
      makeFakeGearLeverProvider({ available: false }),
      makeFakeToolsProvider({ available: true, globals: { pnpm: '10' } }),
      makeFakeGitProvider()
    )
    expect(groups.map((g) => g.capability)).toEqual(['tools'])
    expect(groups[0].items[0]).toEqual({
      key: 'pnpm',
      label: 'pnpm',
      managed: false,
      ignored: false
    })
  })

  it('toggleSyncItemIgnoreBulk ignores every key in a group in one shot, under the right kind', () => {
    toggleSyncItemIgnoreBulk(fixture.ctx, 'apt', ['zoom', 'unityhub', 'firefox'], true)
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(
      new Set(['firefox', 'unityhub', 'zoom'])
    )
  })

  it('toggleSyncItemIgnoreBulk un-ignores in one shot, leaving other capabilities untouched', () => {
    toggleSyncItemIgnoreBulk(fixture.ctx, 'apt', ['zoom', 'unityhub'], true)
    toggleSyncItemIgnore(fixture.ctx, 'flatpak', 'org.deskflow.deskflow', true)
    toggleSyncItemIgnoreBulk(fixture.ctx, 'apt', ['zoom'], false)
    expect(readIgnoreSet(fixture.ctx, 'apt', 'packages')).toEqual(new Set(['unityhub']))
    expect(readIgnoreSet(fixture.ctx, 'flatpak', 'apps')).toEqual(
      new Set(['org.deskflow.deskflow'])
    )
  })

  it('toggleSyncItemIgnoreBulk on a detection-only capability (snap) still writes ignore.toml', () => {
    toggleSyncItemIgnoreBulk(fixture.ctx, 'snap', ['code', 'discord'], true)
    expect(readIgnoreSet(fixture.ctx, 'snap', 'packages')).toEqual(new Set(['code', 'discord']))
  })
})
