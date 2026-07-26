import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture, writeIgnore, type TestFixture } from '../../testFixtures'
import { FONTS_LAYER } from './constants'
import { diffFonts } from './diff'
import { planFonts, planFontsUninstall } from './plan'
import { fontDirs, fontInstallDir } from './scan'
import {
  makeFakeFontAssetResolver,
  makeFakeFontDownloader,
  makeFakeFontsSystemProvider,
  makeFakeZipExtractor
} from './testHelpers'

describe('planFonts', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('produces no actions when diff has no drift', async () => {
    const diff = await diffFonts(fixture.ctx)
    const actions = planFonts(
      fixture.ctx,
      diff,
      makeFakeFontAssetResolver(),
      makeFakeFontDownloader(),
      makeFakeZipExtractor(),
      makeFakeFontsSystemProvider(),
      'run1'
    )
    expect(actions).toEqual([])
  })

  it('a static-source install action is never privileged and downloads every URL', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: {
            kind: 'static',
            urls: [
              'https://example.com/MesloLGS%20NF%20Regular.ttf',
              'https://example.com/MesloLGS%20NF%20Bold.ttf'
            ]
          },
          files: ['MesloLGS NF Regular.ttf', 'MesloLGS NF Bold.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    expect(diff.toInstall).toEqual(['MesloLGS NF'])

    const downloader = makeFakeFontDownloader()
    const systemProvider = makeFakeFontsSystemProvider()
    const actions = planFonts(
      fixture.ctx,
      diff,
      makeFakeFontAssetResolver(),
      downloader,
      makeFakeZipExtractor(),
      systemProvider,
      'run1'
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].privileged).toBeFalsy()

    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(downloader.calls).toHaveLength(2)
    expect(systemProvider.runFcCacheCalls).toHaveLength(1)
    expect(fs.existsSync(fontInstallDir(fixture.ctx, 'MesloLGS NF'))).toBe(true)
  })

  it('a github-release install action resolves asset, downloads zip, extracts fonts, then runs fc-cache', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'D2Coding',
          source: {
            kind: 'github-release',
            coordinate: 'naver/d2codingfont',
            assetPattern: 'D2Coding-Ver*.zip'
          },
          files: ['D2Coding-Ver1.3.3-20260725.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    const resolver = makeFakeFontAssetResolver({
      assetsByCoordinate: {
        'naver/d2codingfont': {
          name: 'D2Coding-Ver1.3.3-20260725.zip',
          downloadUrl: 'https://example.com/D2Coding-Ver1.3.3-20260725.zip'
        }
      }
    })
    const downloader = makeFakeFontDownloader()
    const zipExtractor = makeFakeZipExtractor({
      result: { ok: true, extractedPaths: ['/tmp/D2Coding-Ver1.3.3-20260725.ttf'] }
    })
    const systemProvider = makeFakeFontsSystemProvider()

    const actions = planFonts(
      fixture.ctx,
      diff,
      resolver,
      downloader,
      zipExtractor,
      systemProvider,
      'run1'
    )
    expect(actions).toHaveLength(1)

    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(downloader.calls).toHaveLength(1)
    expect(downloader.calls[0].url).toBe('https://example.com/D2Coding-Ver1.3.3-20260725.zip')
    expect(zipExtractor.calls).toHaveLength(1)
    expect(zipExtractor.calls[0].destDir).toBe(fontInstallDir(fixture.ctx, 'D2Coding'))
    expect(systemProvider.runFcCacheCalls).toHaveLength(1)
  })

  it('reports a clean failure when no matching release asset can be resolved', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'D2Coding',
          source: {
            kind: 'github-release',
            coordinate: 'naver/d2codingfont',
            assetPattern: 'D2Coding-Ver*.zip'
          },
          files: ['D2Coding-Ver1.3.3-20260725.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    const actions = planFonts(
      fixture.ctx,
      diff,
      makeFakeFontAssetResolver(), // 빈 옵션 -- 항상 null
      makeFakeFontDownloader(),
      makeFakeZipExtractor(),
      makeFakeFontsSystemProvider(),
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('asset')
  })

  it('a download failure is reported cleanly, no throw', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: { kind: 'static', urls: ['https://example.com/MesloLGS%20NF%20Regular.ttf'] },
          files: ['MesloLGS NF Regular.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    const downloader = makeFakeFontDownloader({
      result: { ok: false, detail: 'download 실패: network error' }
    })
    const actions = planFonts(
      fixture.ctx,
      diff,
      makeFakeFontAssetResolver(),
      downloader,
      makeFakeZipExtractor(),
      makeFakeFontsSystemProvider(),
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('download 실패')
  })

  it('reports a clean failure when the zip has no matching font files', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'D2Coding',
          source: {
            kind: 'github-release',
            coordinate: 'naver/d2codingfont',
            assetPattern: 'D2Coding-Ver*.zip'
          },
          files: ['D2Coding-Ver1.3.3-20260725.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    const resolver = makeFakeFontAssetResolver({
      assetsByCoordinate: {
        'naver/d2codingfont': {
          name: 'D2Coding-Ver1.3.3-20260725.zip',
          downloadUrl: 'https://example.com/D2Coding-Ver1.3.3-20260725.zip'
        }
      }
    })
    const zipExtractor = makeFakeZipExtractor({ result: { ok: true, extractedPaths: [] } })
    const actions = planFonts(
      fixture.ctx,
      diff,
      resolver,
      makeFakeFontDownloader(),
      zipExtractor,
      makeFakeFontsSystemProvider(),
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('폰트 파일')
  })
})

// 항목 삭제(uninstall) 엔진 — 안전 불변식 5(2026-07-26 개정).
describe('planFontsUninstall', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  function writeInstalledMeslo(): string[] {
    const dir = fontDirs(fixture.ctx)[0]
    fs.mkdirSync(dir, { recursive: true })
    const files = ['MesloLGS NF Regular.ttf', 'MesloLGS NF Bold.ttf']
    for (const f of files) fs.writeFileSync(path.join(dir, f), 'fake-font-bytes')
    return files
  }

  it('rejects a managed (manifest-declared) font even if ignored — safety invariant 5', async () => {
    writeInstalledMeslo()
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: { kind: 'static', urls: [] },
          files: ['MesloLGS NF Regular.ttf', 'MesloLGS NF Bold.ttf']
        }
      ]
    })
    writeIgnore(fixture, { fonts: { names: ['MesloLGS NF'] } })

    const result = planFontsUninstall(
      fixture.ctx,
      ['MesloLGS NF'],
      makeFakeFontsSystemProvider(),
      'run-reject-managed'
    )

    expect(result.actions).toEqual([])
    expect(result.excluded).toEqual([
      { capability: 'fonts', key: 'MesloLGS NF', reason: expect.stringContaining('managed') }
    ])
  })

  it('rejects a font that is not ignored (paused) yet', async () => {
    writeInstalledMeslo()
    const result = planFontsUninstall(
      fixture.ctx,
      ['MesloLGS NF'],
      makeFakeFontsSystemProvider(),
      'run-not-ignored'
    )
    expect(result.actions).toEqual([])
    expect(result.excluded[0].reason).toContain('일시중지')
  })

  it('rejects a font that is not installed (not recognized by the registry) on this machine', async () => {
    writeIgnore(fixture, { fonts: { names: ['MesloLGS NF'] } })
    const result = planFontsUninstall(
      fixture.ctx,
      ['MesloLGS NF'],
      makeFakeFontsSystemProvider(),
      'run-not-installed'
    )
    expect(result.actions).toEqual([])
    expect(result.excluded[0].reason).toContain('설치돼 있지 않음')
  })

  it('backs up then deletes every file belonging to an ignored+unmanaged font, then runs fc-cache', async () => {
    const files = writeInstalledMeslo()
    writeIgnore(fixture, { fonts: { names: ['MesloLGS NF'] } })
    const systemProvider = makeFakeFontsSystemProvider()

    const runTs = 'run-delete-font'
    const result = planFontsUninstall(fixture.ctx, ['MesloLGS NF'], systemProvider, runTs)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].privileged).toBeFalsy()

    const runResult = await result.actions[0].run()
    expect(runResult.ok).toBe(true)
    expect(systemProvider.runFcCacheCalls).toHaveLength(1)

    const dir = fontDirs(fixture.ctx)[0]
    for (const f of files) {
      expect(fs.existsSync(path.join(dir, f))).toBe(false)
    }
    const backupDir = path.join(fixture.ctx.backupRoot, runTs)
    expect(fs.existsSync(backupDir)).toBe(true)
  })
})
