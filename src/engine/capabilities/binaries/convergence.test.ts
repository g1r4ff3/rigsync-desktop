/**
 * apply → diff 수렴 e2e 테스트 — fonts capability가 실사용 버그(release asset
 * 파일명에 버전이 박혀 정확 일치 판정이 영원히 수렴하지 않던 문제)를 겪고 나서
 * 굳힌 회귀 방지 패턴을 binaries에도 그대로 적용한다. binaries는 실행파일
 * 이름 자체가 버전과 무관한 고정값(uv는 항상 "uv")이라 구조적으로 그 함정에
 * 걸리지 않지만, "apply가 실제로 설치한 결과로 재-diff하면 drift 0이 된다"는
 * 성질은 여전히 명시적으로 고정해 둘 가치가 있다(회귀 방지).
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { BINARIES_LAYER } from './constants'
import { diffBinaries } from './diff'
import { planBinaries } from './plan'
import type { TarExtractor, TarExtractResult } from './providerTypes'
import {
  makeFakeBinariesSystemProvider,
  makeFakeBinaryAssetResolver,
  makeFakeBinaryDownloader,
  makeFakeBinaryZipExtractor,
  makeWritingFakeBinaryDownloader
} from './testHelpers'

function makeWritingTarExtractor(filenames: readonly string[]): TarExtractor {
  const write = (destDir: string): TarExtractResult => {
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

describe('binaries apply -> diff convergence', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('tar.gz source (uv+uvx): after apply, re-diff reports drift 0 and a second plan is empty', async () => {
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
    const systemProvider = makeFakeBinariesSystemProvider()
    const diff1 = await diffBinaries(fixture.ctx, systemProvider)
    expect(diff1.toInstall).toEqual(['uv'])

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
      diff1,
      resolver,
      makeFakeBinaryDownloader(),
      makeFakeBinaryZipExtractor(),
      tarExtractor,
      'run1'
    )
    expect(actions).toHaveLength(1)
    const result = await actions[0].run()
    expect(result.ok).toBe(true)

    const diff2 = await diffBinaries(fixture.ctx, systemProvider)
    expect(diff2.toInstall).toEqual([])
    expect(
      planBinaries(
        fixture.ctx,
        diff2,
        resolver,
        makeFakeBinaryDownloader(),
        makeFakeBinaryZipExtractor(),
        tarExtractor,
        'run2'
      )
    ).toEqual([])
  })

  it('single-binary source (micromamba): after apply, re-diff reports drift 0', async () => {
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
    const systemProvider = makeFakeBinariesSystemProvider()
    const diff1 = await diffBinaries(fixture.ctx, systemProvider)
    expect(diff1.toInstall).toEqual(['micromamba'])

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
      diff1,
      resolver,
      makeWritingFakeBinaryDownloader(),
      makeFakeBinaryZipExtractor(),
      makeWritingTarExtractor([]),
      'run1'
    )
    const result = await actions[0].run()
    expect(result.ok).toBe(true)

    const diff2 = await diffBinaries(fixture.ctx, systemProvider)
    expect(diff2.toInstall).toEqual([])
  })

  it('a version upgrade (uv 0.11.2 -> 0.11.32) with no pin never shows drift -- unpinned entries track "latest" by design', async () => {
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
    const installDir = path.join(fixture.homeDir, '.local', 'bin')
    fs.mkdirSync(installDir, { recursive: true })
    for (const name of ['uv', 'uvx']) {
      const p = path.join(installDir, name)
      fs.writeFileSync(p, 'fake')
      fs.chmodSync(p, 0o755)
    }
    // 버전이 다르더라도(레지스트리는 파일명만으로 판정하고, pin이 없으므로
    // 버전 확인 자체를 하지 않는다) drift가 없어야 한다.
    const systemProvider = makeFakeBinariesSystemProvider({
      resultsByBinaryPath: {
        [path.join(installDir, 'uv')]: { ok: true, output: 'uv 0.11.32 (x86_64-unknown-linux-gnu)' }
      }
    })
    const diff = await diffBinaries(fixture.ctx, systemProvider)
    expect(diff.toInstall).toEqual([])
    expect(diff.pinMismatch).toEqual([])
    // pin이 없으니 버전 확인 명령 자체가 호출되지 않아야 한다(불필요한 실행 방지).
    expect(systemProvider.calls).toEqual([])
  })
})
