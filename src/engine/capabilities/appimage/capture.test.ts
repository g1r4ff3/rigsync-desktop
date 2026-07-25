import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { effectiveLayer } from '../../manifest'
import { captureAppimage, FollowerAppimageCaptureBlockedError } from './capture'
import { APPIMAGE_KEY_FIELDS, APPIMAGE_LAYER } from './constants'
import { makeFakeGearLeverProvider } from './testHelpers'
import type { AppimageEntry } from './types'

// 신규 테스트 — 구 repo(pre-Gear-Lever URL 템플릿+glob 스캔 모델)엔 이 모델에
// 대응하는 케이스가 없다. `--list-installed --json`의 `name` 필드 fixture는
// 이 세션에서 이 머신에 실제로 통합된 tev를 그대로 옮긴 것(§7 실측) —
// "tev (2.13.1)"처럼 **버전이 섞인 문자열**임을 캡처가 무시하고 desktop_id를
// 키로 쓰는지가 이 테스트의 핵심.

describe('captureAppimage', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('reports skipped when Gear Lever is unavailable', async () => {
    const provider = makeFakeGearLeverProvider({ available: false })
    const report = await captureAppimage(fixture.ctx, provider, { dryRun: false })
    expect(report.skipped).toBe(true)
  })

  it('rejects capture on a follower machine', async () => {
    const follower = makeFixture('follower')
    try {
      const provider = makeFakeGearLeverProvider()
      await expect(captureAppimage(follower.ctx, provider, { dryRun: false })).rejects.toThrow(
        FollowerAppimageCaptureBlockedError
      )
    } finally {
      follower.cleanup()
    }
  })

  it('captures tev using desktop_id as the key, never the versioned JSON name (real fixture)', async () => {
    const appImagePath = '/home/cglab/AppImages/tev.appimage'
    const provider = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'tev (2.13.1)', // 실측 함정 -- 버전이 섞여 있다
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
          name: 'tev',
          filePath: appImagePath,
          updateManager: {
            repo: 'Tom94/tev',
            repoFilename: 'tev.appimage',
            manager: 'GithubUpdater',
            allowPrereleases: false
          }
        }
      }
    })

    const report = await captureAppimage(fixture.ctx, provider, { dryRun: false })
    expect(report.added).toBe(1)

    const manifest = effectiveLayer(fixture.ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS)
    const entries = (manifest.app as AppimageEntry[]) ?? []
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('tev.desktop') // desktop_id, 절대 "tev (2.13.1)" 아님
    expect(entries[0].source).toBe('GithubUpdater')
    expect(entries[0].coordinate).toBe('Tom94/tev')
    expect(entries[0].repoFilename).toBe('tev.appimage')
    expect(entries[0].pin).toBeFalsy()
  })

  it('preserves an existing pin across recapture (capture never touches pin)', async () => {
    const appImagePath = '/home/x/AppImages/foo.appimage'
    const provider = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'foo (1.0.0)',
          path: appImagePath,
          desktopId: 'foo.desktop',
          currentVersion: '1.0.0',
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
            repo: 'owner/foo',
            repoFilename: 'foo.appimage',
            manager: 'GithubUpdater'
          }
        }
      }
    })

    await captureAppimage(fixture.ctx, provider, { dryRun: false })
    // 사용자가 수동으로 pin을 건 상태를 흉내낸다.
    const before = effectiveLayer(fixture.ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS)
      .app as AppimageEntry[]
    expect(before[0].pin).toBeFalsy()

    // (테스트 편의를 위해 매니페스트를 직접 pin 걸어 재기록)
    const { writeCommonLayer } = await import('../../manifest')
    writeCommonLayer(fixture.ctx, APPIMAGE_LAYER, {
      app: [{ ...before[0], pin: '0.9.0' }]
    })

    await captureAppimage(fixture.ctx, provider, { dryRun: false })
    const after = effectiveLayer(fixture.ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS)
      .app as AppimageEntry[]
    expect(after[0].pin).toBe('0.9.0')
  })

  it('skips (with a note) an installed app whose update-source coordinates are missing from gearlever.conf', async () => {
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
      // configsByPath 없음 -- gearlever.conf에 좌표가 없는 상황을 흉내낸다.
    })

    const report = await captureAppimage(fixture.ctx, provider, { dryRun: false })
    expect(report.added).toBe(0)
    expect(report.notes.some((n) => n.includes('orphan.desktop'))).toBe(true)

    const manifest = effectiveLayer(fixture.ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS)
    expect((manifest.app as AppimageEntry[] | undefined) ?? []).toHaveLength(0)
  })

  it('dry-run computes counts but writes nothing to the manifest', async () => {
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

    await captureAppimage(fixture.ctx, provider, { dryRun: true })
    const manifest = effectiveLayer(fixture.ctx, APPIMAGE_LAYER, APPIMAGE_KEY_FIELDS)
    expect((manifest.app as AppimageEntry[] | undefined) ?? []).toHaveLength(0)
  })
})
