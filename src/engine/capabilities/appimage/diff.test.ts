import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { APPIMAGE_LAYER } from './constants'
import { diffAppimage } from './diff'
import { makeFakeGearLeverProvider } from './testHelpers'

describe('diffAppimage', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('reports skipped when Gear Lever is unavailable', async () => {
    const diff = await diffAppimage(fixture.ctx, makeFakeGearLeverProvider({ available: false }))
    expect(diff.skipped).toBe(true)
  })

  it('reports toInstall for a manifested app that is not installed', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'tev.desktop',
          source: 'GithubUpdater',
          coordinate: 'Tom94/tev',
          repoFilename: 'tev.appimage',
          pin: null
        }
      ]
    })
    const diff = await diffAppimage(fixture.ctx, makeFakeGearLeverProvider({ installed: [] }))
    expect(diff.toInstall).toEqual(['tev.desktop'])
  })

  it('is in sync when installed and no pin is set', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'tev.desktop',
          source: 'GithubUpdater',
          coordinate: 'Tom94/tev',
          repoFilename: 'tev.appimage',
          pin: null
        }
      ]
    })
    const diff = await diffAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider({
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
    )
    expect(diff.toInstall).toEqual([])
    expect(diff.pinMismatch).toEqual([])
  })

  it('reports a pin mismatch when the installed version differs from the pinned version', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'tev.desktop',
          source: 'GithubUpdater',
          coordinate: 'Tom94/tev',
          repoFilename: 'tev.appimage',
          pin: '2.10.0'
        }
      ]
    })
    const diff = await diffAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider({
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
    )
    expect(diff.pinMismatch).toEqual([
      { name: 'tev.desktop', pinned: '2.10.0', installed: '2.13.1' }
    ])
  })

  it('flags a non-GithubUpdater source as unsupported', async () => {
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [
        {
          name: 'foo.desktop',
          source: 'StaticFileUpdater',
          coordinate: 'https://example.com/foo.appimage',
          repoFilename: 'foo.appimage',
          pin: null
        }
      ]
    })
    const diff = await diffAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider({
        installed: [
          {
            name: 'foo (1.0)',
            path: '/home/x/foo.appimage',
            desktopId: 'foo.desktop',
            currentVersion: '1.0',
            availableVersion: null,
            downloadSize: null,
            manager: 'StaticFileUpdater',
            embeddedSource: false,
            running: false
          }
        ]
      })
    )
    expect(diff.unsupportedSource).toEqual(['foo.desktop'])
  })

  it('reports an installed-but-unmanifested app as uncaptured', async () => {
    const diff = await diffAppimage(
      fixture.ctx,
      makeFakeGearLeverProvider({
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
    )
    expect(diff.uncaptured).toEqual(['tev.desktop'])
  })
})
