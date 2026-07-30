import { describe, expect, it } from 'vitest'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { APPIMAGE_LAYER } from './constants'
import { makeFakeGearLeverProvider } from './testHelpers'
import {
  AppimageEntryNotInstalledError,
  AppimageUpdateSourceUnresolvedError,
  registerAppimageEntry
} from './register'
import type { AppimageEntry } from './types'

function appEntriesOf(fixture: TestFixture): AppimageEntry[] {
  const doc = readCommonLayer(fixture.ctx, APPIMAGE_LAYER)
  return (doc.app as AppimageEntry[] | undefined) ?? []
}

describe('registerAppimageEntry', () => {
  it('gearlever.conf 좌표가 있으면 common appimage.toml에 upsert한다', async () => {
    const fixture = makeFixture('reference')
    const appPath = '/home/user/Applications/tev.AppImage'
    const provider = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'tev (2.13.1)',
          path: appPath,
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
        [appPath]: {
          updateManager: {
            repo: 'Tom94/tev',
            repoFilename: 'tev.appimage',
            manager: 'GithubUpdater'
          }
        }
      }
    })

    await registerAppimageEntry(fixture.ctx, provider, 'tev.desktop')

    expect(appEntriesOf(fixture)).toEqual([
      {
        name: 'tev.desktop',
        source: 'GithubUpdater',
        coordinate: 'Tom94/tev',
        repoFilename: 'tev.appimage'
      }
    ])
    fixture.cleanup()
  })

  it('이 머신에 설치돼 있지 않으면 거부한다', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeGearLeverProvider({ installed: [] })

    await expect(registerAppimageEntry(fixture.ctx, provider, 'tev.desktop')).rejects.toThrow(
      AppimageEntryNotInstalledError
    )
    fixture.cleanup()
  })

  it('update source 좌표를 gearlever.conf에서 못 찾으면 좌표를 추정하지 않고 거부한다', async () => {
    const fixture = makeFixture('reference')
    const appPath = '/home/user/Applications/unknown.AppImage'
    const provider = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'unknown',
          path: appPath,
          desktopId: 'unknown.desktop',
          currentVersion: null,
          availableVersion: null,
          downloadSize: null,
          manager: 'GithubUpdater',
          embeddedSource: false,
          running: false
        }
      ],
      configsByPath: {}
    })

    await expect(registerAppimageEntry(fixture.ctx, provider, 'unknown.desktop')).rejects.toThrow(
      AppimageUpdateSourceUnresolvedError
    )
    expect(appEntriesOf(fixture)).toHaveLength(0)
    fixture.cleanup()
  })

  it('기존 pin은 재등록해도 보존한다', async () => {
    const fixture = makeFixture('reference')
    const appPath = '/home/user/Applications/tev.AppImage'
    const provider = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'tev (2.13.1)',
          path: appPath,
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
        [appPath]: {
          updateManager: {
            repo: 'Tom94/tev',
            repoFilename: 'tev.appimage',
            manager: 'GithubUpdater'
          }
        }
      }
    })

    await registerAppimageEntry(fixture.ctx, provider, 'tev.desktop')
    // 사용자가 수동으로 pin을 건 상태를 흉내낸다.
    const entries = appEntriesOf(fixture).map((e) =>
      e.name === 'tev.desktop' ? { ...e, pin: '2.13.0' } : e
    )
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, { app: entries })

    await registerAppimageEntry(fixture.ctx, provider, 'tev.desktop')

    expect(appEntriesOf(fixture)[0].pin).toBe('2.13.0')
    fixture.cleanup()
  })
})
