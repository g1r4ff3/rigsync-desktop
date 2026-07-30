import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture, writeSelection, type TestFixture } from '../../testFixtures'
import { BINARIES_LAYER } from './constants'
import { diffBinaries } from './diff'
import { makeFakeBinariesSystemProvider } from './testHelpers'

function writeExecutable(fixture: TestFixture, relDir: string, filename: string): string {
  const dir = path.join(fixture.homeDir, relDir)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, filename)
  fs.writeFileSync(target, '#!/bin/sh\necho fake\n')
  fs.chmodSync(target, 0o755)
  return target
}

describe('diffBinaries', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('reports toInstall when a manifested tool is entirely missing', async () => {
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
    expect(diff.toInstall).toEqual(['uv'])
  })

  it('reports toInstall when only some declared binaries are present', async () => {
    writeExecutable(fixture, '.local/bin', 'uv')
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
    expect(diff.toInstall).toEqual(['uv'])
  })

  it('is in sync when all declared binaries are present and executable', async () => {
    writeExecutable(fixture, '.local/bin', 'uv')
    writeExecutable(fixture, '.local/bin', 'uvx')
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
    expect(diff.toInstall).toEqual([])
    expect(diff.pinMismatch).toEqual([])
  })

  it('is not fooled by a non-executable file with the right name (regular file, no +x)', async () => {
    const dir = path.join(fixture.homeDir, '.local', 'bin')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'uv'), 'not executable')
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
          binaries: ['uv']
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    expect(diff.toInstall).toEqual(['uv'])
  })

  it('honors a custom installDir declared on the entry', async () => {
    writeExecutable(fixture, 'bin', 'micromamba')
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
          installDir: '~/bin'
        }
      ]
    })
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    expect(diff.toInstall).toEqual([])
  })

  it('reports a pin mismatch when the installed version differs from the pinned version', async () => {
    const target = writeExecutable(fixture, '.local/bin', 'micromamba')
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
    const systemProvider = makeFakeBinariesSystemProvider({
      resultsByBinaryPath: { [target]: { ok: true, output: '2.3.3\n' } }
    })
    const diff = await diffBinaries(fixture.ctx, systemProvider)
    expect(diff.toInstall).toEqual([])
    expect(diff.pinMismatch).toEqual([
      { name: 'micromamba', pinned: '2.8.1-0', installedVersion: '2.3.3' }
    ])
  })

  it('no pin mismatch reported when the installed version matches the pin', async () => {
    const target = writeExecutable(fixture, '.local/bin', 'micromamba')
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
          pin: '2.3.3'
        }
      ]
    })
    const systemProvider = makeFakeBinariesSystemProvider({
      resultsByBinaryPath: { [target]: { ok: true, output: '2.3.3\n' } }
    })
    const diff = await diffBinaries(fixture.ctx, systemProvider)
    expect(diff.pinMismatch).toEqual([])
  })

  it('reports an installed-but-unmanifested known tool as uncaptured', async () => {
    writeExecutable(fixture, '.local/bin', 'micromamba')
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    expect(diff.uncaptured).toEqual(['micromamba'])
  })

  it('does not surface unknown (unregistered) installed executables as uncaptured', async () => {
    writeExecutable(fixture, '.local/bin', 'rtk')
    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    expect(diff.uncaptured).toEqual([])
  })

  it(
    '실사례(코디네이터 확인): ~/micromamba/envs/<name>/bin/uv 환경 스코프 설치는 uncaptured로도 ' +
      '잡히지 않는다 -- 스캔 자체가 installDir 밖을 보지 않는다',
    async () => {
      writeExecutable(fixture, 'micromamba/envs/yolo26pose/bin', 'uv')
      const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
      expect(diff.uncaptured).toEqual([])
      expect(diff.toInstall).toEqual([])
    }
  )

  // WS2("창고 모델" 구독 강제) 안전 규칙 1: 미구독 엔트리는 install/drift
  // 판정에서만 skip한다(제거 plan 없음).
  it('does not propose install for an unsubscribed manifested tool (WS2)', async () => {
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
    writeSelection(fixture, { mode: 'all', binaries: { exclude: ['uv'] } })

    const diff = await diffBinaries(fixture.ctx, makeFakeBinariesSystemProvider())
    expect(diff.toInstall).toEqual([])
  })
})
