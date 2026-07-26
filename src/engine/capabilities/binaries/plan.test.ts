import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { BINARIES_LAYER } from './constants'
import { diffBinaries } from './diff'
import { planBinaries } from './plan'
import type { TarExtractor } from './providerTypes'
import { resolveBinariesInstallDir } from './scan'
import {
  makeFakeBinariesSystemProvider,
  makeFakeBinaryAssetResolver,
  makeFakeBinaryDownloader,
  makeFakeBinaryZipExtractor,
  makeFakeTarExtractor,
  makeWritingFakeBinaryDownloader
} from './testHelpers'

/** 실제 apply처럼 destDir에 진짜 파일을 쓰는 tar extractor 페이크. */
function makeWritingTarExtractor(filenames: readonly string[]): TarExtractor {
  const write = (destDir: string): { ok: true; extractedPaths: string[] } => {
    fs.mkdirSync(destDir, { recursive: true })
    const extractedPaths = filenames.map((name) => {
      const dest = path.join(destDir, name)
      fs.writeFileSync(dest, 'fake-binary-bytes')
      return dest
    })
    return { ok: true, extractedPaths }
  }
  return {
    extractGz: (_tarPath, destDir) => write(destDir),
    extractBz2: (_tarPath, destDir) => write(destDir)
  }
}

describe('planBinaries', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('produces no actions when diff has no drift', async () => {
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    const actions = planBinaries(
      fixture.ctx,
      diff,
      makeFakeBinaryAssetResolver(),
      makeFakeBinaryDownloader(),
      makeFakeBinaryZipExtractor(),
      makeFakeTarExtractor(),
      'run1'
    )
    expect(actions).toEqual([])
  })

  it('a single-binary install action downloads the asset, places it under the declared name, and chmods 0755', async () => {
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [
        {
          name: 'micromamba',
          source: {
            kind: 'github-release',
            coordinate: 'mamba-org/micromamba-releases',
            assetPattern: 'micromamba-linux-64',
            assetKind: 'single-binary'
          },
          binaries: ['micromamba']
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    expect(diff.toInstall).toEqual(['micromamba'])

    const resolver = makeFakeBinaryAssetResolver({
      assetsByCoordinate: {
        'mamba-org/micromamba-releases': {
          name: 'micromamba-linux-64',
          downloadUrl: 'https://example.com/micromamba-linux-64'
        }
      }
    })
    const downloader = makeWritingFakeBinaryDownloader()
    const actions = planBinaries(
      fixture.ctx,
      diff,
      resolver,
      downloader,
      makeFakeBinaryZipExtractor(),
      makeFakeTarExtractor(),
      'run1'
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].privileged).toBeFalsy()

    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(downloader.calls).toHaveLength(1)

    const installed = path.join(resolveBinariesInstallDir(fixture.ctx), 'micromamba')
    expect(fs.existsSync(installed)).toBe(true)
    // eslint-disable-next-line no-bitwise
    expect(fs.statSync(installed).mode & 0o777).toBe(0o755)
  })

  it('a tar.gz install action extracts every declared binary and chmods each 0755', async () => {
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [
        {
          name: 'uv',
          source: {
            kind: 'github-release',
            coordinate: 'astral-sh/uv',
            assetPattern: 'uv-x86_64-unknown-linux-gnu.tar.gz',
            assetKind: 'tar.gz'
          },
          binaries: ['uv', 'uvx']
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    const resolver = makeFakeBinaryAssetResolver({
      assetsByCoordinate: {
        'astral-sh/uv': {
          name: 'uv-x86_64-unknown-linux-gnu.tar.gz',
          downloadUrl: 'https://example.com/uv-x86_64-unknown-linux-gnu.tar.gz'
        }
      }
    })
    const tarExtractor = makeWritingTarExtractor(['uv', 'uvx'])
    const actions = planBinaries(
      fixture.ctx,
      diff,
      resolver,
      makeFakeBinaryDownloader(),
      makeFakeBinaryZipExtractor(),
      tarExtractor,
      'run1'
    )
    expect(actions).toHaveLength(1)

    const result = await actions[0].run()
    expect(result.ok).toBe(true)

    const installDir = resolveBinariesInstallDir(fixture.ctx)
    for (const name of ['uv', 'uvx']) {
      const installed = path.join(installDir, name)
      expect(fs.existsSync(installed)).toBe(true)
      // eslint-disable-next-line no-bitwise
      expect(fs.statSync(installed).mode & 0o777).toBe(0o755)
    }
  })

  it('a tar.bz2 install action routes through extractBz2', async () => {
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [
        {
          name: 'sometool',
          source: {
            kind: 'github-release',
            coordinate: 'someorg/sometool',
            assetPattern: 'sometool-linux.tar.bz2',
            assetKind: 'tar.bz2'
          },
          binaries: ['sometool']
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    const resolver = makeFakeBinaryAssetResolver({
      assetsByCoordinate: {
        'someorg/sometool': {
          name: 'sometool-linux.tar.bz2',
          downloadUrl: 'https://example.com/sometool-linux.tar.bz2'
        }
      }
    })
    const tarExtractor = makeWritingTarExtractor(['sometool'])
    const bz2Spy = { calls: 0 }
    const spyExtractor = {
      extractGz: tarExtractor.extractGz,
      extractBz2: (tarPath: string, destDir: string, filter: (n: string) => boolean) => {
        bz2Spy.calls += 1
        return tarExtractor.extractBz2(tarPath, destDir, filter)
      }
    }
    const actions = planBinaries(
      fixture.ctx,
      diff,
      resolver,
      makeFakeBinaryDownloader(),
      makeFakeBinaryZipExtractor(),
      spyExtractor,
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(bz2Spy.calls).toBe(1)
  })

  it('a zip install action routes through the (fonts-shared) zip extractor', async () => {
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [
        {
          name: 'zippedtool',
          source: {
            kind: 'github-release',
            coordinate: 'someorg/zippedtool',
            assetPattern: 'zippedtool.zip',
            assetKind: 'zip'
          },
          binaries: ['zippedtool']
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    const resolver = makeFakeBinaryAssetResolver({
      assetsByCoordinate: {
        'someorg/zippedtool': {
          name: 'zippedtool.zip',
          downloadUrl: 'https://example.com/zippedtool.zip'
        }
      }
    })
    // plan.ts는 추출 결과 경로에 chmod 0755를 부여한다(코디네이터 지시) — 그
    // 경로가 실제로 존재해야 하므로, 이 fake는 실제 install dir 안에 파일을
    // 미리 써 둔다(zip 라이브러리 자체는 여전히 호출되지 않는다 — fake일 뿐).
    const extractedPath = path.join(resolveBinariesInstallDir(fixture.ctx), 'zippedtool')
    fs.mkdirSync(path.dirname(extractedPath), { recursive: true })
    fs.writeFileSync(extractedPath, 'fake-zip-extracted-bytes')
    const zipExtractor = makeFakeBinaryZipExtractor({
      result: { ok: true, extractedPaths: [extractedPath] }
    })
    const actions = planBinaries(
      fixture.ctx,
      diff,
      resolver,
      makeFakeBinaryDownloader(),
      zipExtractor,
      makeFakeTarExtractor(),
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(true)
    expect(zipExtractor.calls).toHaveLength(1)
    // eslint-disable-next-line no-bitwise
    expect(fs.statSync(extractedPath).mode & 0o777).toBe(0o755)
  })

  it('reports a clean failure when no matching release asset can be resolved', async () => {
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [
        {
          name: 'uv',
          source: {
            kind: 'github-release',
            coordinate: 'astral-sh/uv',
            assetPattern: 'uv-x86_64-unknown-linux-gnu.tar.gz',
            assetKind: 'tar.gz'
          },
          binaries: ['uv', 'uvx']
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    const actions = planBinaries(
      fixture.ctx,
      diff,
      makeFakeBinaryAssetResolver(), // 빈 옵션 -- 항상 null
      makeFakeBinaryDownloader(),
      makeFakeBinaryZipExtractor(),
      makeFakeTarExtractor(),
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('asset')
  })

  it('a download failure is reported cleanly, no throw', async () => {
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [
        {
          name: 'micromamba',
          source: {
            kind: 'github-release',
            coordinate: 'mamba-org/micromamba-releases',
            assetPattern: 'micromamba-linux-64',
            assetKind: 'single-binary'
          },
          binaries: ['micromamba']
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    const resolver = makeFakeBinaryAssetResolver({
      assetsByCoordinate: {
        'mamba-org/micromamba-releases': {
          name: 'micromamba-linux-64',
          downloadUrl: 'https://example.com/micromamba-linux-64'
        }
      }
    })
    const downloader = makeFakeBinaryDownloader({
      result: { ok: false, detail: 'download 실패: network error' }
    })
    const actions = planBinaries(
      fixture.ctx,
      diff,
      resolver,
      downloader,
      makeFakeBinaryZipExtractor(),
      makeFakeTarExtractor(),
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('download 실패')
  })

  it('reports a clean failure when the archive has no matching binaries', async () => {
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [
        {
          name: 'uv',
          source: {
            kind: 'github-release',
            coordinate: 'astral-sh/uv',
            assetPattern: 'uv-x86_64-unknown-linux-gnu.tar.gz',
            assetKind: 'tar.gz'
          },
          binaries: ['uv', 'uvx']
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    const resolver = makeFakeBinaryAssetResolver({
      assetsByCoordinate: {
        'astral-sh/uv': {
          name: 'uv-x86_64-unknown-linux-gnu.tar.gz',
          downloadUrl: 'https://example.com/uv-x86_64-unknown-linux-gnu.tar.gz'
        }
      }
    })
    const tarExtractor = makeFakeTarExtractor({ gzResult: { ok: true, extractedPaths: [] } })
    const actions = planBinaries(
      fixture.ctx,
      diff,
      resolver,
      makeFakeBinaryDownloader(),
      makeFakeBinaryZipExtractor(),
      tarExtractor,
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('실행파일')
  })

  it('backs up an existing binary before overwriting it (idempotent re-install)', async () => {
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [
        {
          name: 'micromamba',
          source: {
            kind: 'github-release',
            coordinate: 'mamba-org/micromamba-releases',
            assetPattern: 'micromamba-linux-64',
            assetKind: 'single-binary'
          },
          binaries: ['micromamba'],
          pin: '2.8.1-0'
        }
      ]
    })
    const installDir = resolveBinariesInstallDir(fixture.ctx)
    fs.mkdirSync(installDir, { recursive: true })
    const existingPath = path.join(installDir, 'micromamba')
    fs.writeFileSync(existingPath, 'old-version-bytes')
    fs.chmodSync(existingPath, 0o755)

    // pin mismatch로 toInstall에는 안 들어가지만(파일이 존재하고 실행 가능하므로),
    // 이 테스트는 plan의 백업 경로 자체를 직접 액션으로 확인한다 -- toInstall을
    // 강제로 채워 makeInstallAction 경로를 그대로 태운다.
    const diff = { toInstall: ['micromamba'], pinMismatch: [], uncaptured: [] }
    const resolver = makeFakeBinaryAssetResolver({
      assetsByCoordinate: {
        'mamba-org/micromamba-releases': {
          name: 'micromamba-linux-64',
          downloadUrl: 'https://example.com/micromamba-linux-64'
        }
      }
    })
    const actions = planBinaries(
      fixture.ctx,
      diff,
      resolver,
      makeWritingFakeBinaryDownloader(),
      makeFakeBinaryZipExtractor(),
      makeFakeTarExtractor(),
      'run-backup-test'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(true)

    const backupDir = path.join(fixture.homeDir, '.rigsync-backup', 'run-backup-test')
    expect(fs.existsSync(backupDir)).toBe(true)
  })
})
