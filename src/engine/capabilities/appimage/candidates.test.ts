import { afterEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { buildAppimageSyncGroup } from './candidates'
import { makeFakeGearLeverProvider } from './testHelpers'

// 신규 테스트 — Capture 피드백 UX 수리(rigsync-desktop v0.1.20) 4번: capture가
// 구조적으로 담을 수 없는 항목(update source 좌표 미해석)을 candidates가
// pending-add로 보여주지 않고 unresolvableReason으로 표시하는지 확인한다.
// resolveAppimageUpdateSource(capture.ts)와 같은 판정을 candidates 빌드
// 시점(capture를 돌리지 않고)에 재사용한다는 게 이 테스트의 핵심.

describe('buildAppimageSyncGroup — unresolvable update source', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.cleanup()
    fixture = null
  })

  it('marks an installed-but-unconfigured app with unresolvableReason (no gearlever.conf entry)', async () => {
    fixture = makeFixture('reference')
    const provider = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'orphan (1.0)',
          path: '/home/x/orphan.appimage',
          desktopId: 'orphan.desktop',
          currentVersion: '1.0',
          availableVersion: null,
          downloadSize: null,
          manager: 'GithubUpdater',
          embeddedSource: false,
          running: false
        }
      ]
      // configsByPath 없음 -- gearlever.conf에 좌표가 없는 상황(capture.test.ts와 동일 fixture).
    })

    const group = await buildAppimageSyncGroup(fixture.ctx, provider)
    expect(group).not.toBeNull()
    const item = group!.items.find((i) => i.key === 'orphan.desktop')
    expect(item?.managed).toBe(false)
    expect(item?.unresolvableReason).toBe('gearlever.conf에서 update source 좌표를 찾지 못함')
  })

  it('does not set unresolvableReason for a fully-configured app', async () => {
    fixture = makeFixture('reference')
    const appImagePath = '/home/cglab/AppImages/tev.appimage'
    const provider = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'tev (2.13.1)',
          path: appImagePath,
          desktopId: 'tev.desktop',
          currentVersion: '2.13.1',
          availableVersion: null,
          downloadSize: null,
          manager: 'GithubUpdater',
          embeddedSource: false,
          running: false
        }
      ],
      configsByPath: {
        [appImagePath]: {
          updateManager: {
            repo: 'Tom94/tev',
            repoFilename: 'tev.appimage',
            manager: 'GithubUpdater'
          }
        }
      }
    })

    const group = await buildAppimageSyncGroup(fixture.ctx, provider)
    const item = group!.items.find((i) => i.key === 'tev.desktop')
    expect(item?.unresolvableReason).toBeUndefined()
  })

  it('does not compute unresolvableReason for an already-managed entry (preserved regardless of live config)', async () => {
    fixture = makeFixture('reference')
    const { writeCommonLayer } = await import('../../manifest')
    const { APPIMAGE_LAYER } = await import('./constants')
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'legacy.desktop',
          source: 'GithubUpdater',
          coordinate: 'x/y',
          repoFilename: 'x.appimage'
        }
      ]
    })
    const provider = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'legacy (0.1)',
          path: '/home/x/legacy.appimage',
          desktopId: 'legacy.desktop',
          currentVersion: '0.1',
          availableVersion: null,
          downloadSize: null,
          manager: 'GithubUpdater',
          embeddedSource: false,
          running: false
        }
      ]
      // configsByPath 없음 -- 지금은 gearlever.conf 좌표가 없어졌다고 해도
      // 이미 manifest에 있는(managed) 항목은 재판정하지 않는다.
    })

    const group = await buildAppimageSyncGroup(fixture.ctx, provider)
    const item = group!.items.find((i) => i.key === 'legacy.desktop')
    expect(item?.managed).toBe(true)
    expect(item?.unresolvableReason).toBeUndefined()
  })
})
