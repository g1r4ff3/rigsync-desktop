import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectiveLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { captureBinaries, FollowerBinariesCaptureBlockedError } from './capture'
import { BINARIES_KEY_FIELDS, BINARIES_LAYER } from './constants'
import type { BinaryEntry } from './types'

function writeExecutable(fixture: TestFixture, relDir: string, filename: string): void {
  const dir = path.join(fixture.homeDir, relDir)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, filename)
  fs.writeFileSync(target, '#!/bin/sh\necho fake\n')
  fs.chmodSync(target, 0o755)
}

describe('captureBinaries', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('rejects capture on a follower machine', async () => {
    const follower = makeFixture('follower')
    try {
      await expect(captureBinaries(follower.ctx, { dryRun: false })).rejects.toThrow(
        FollowerBinariesCaptureBlockedError
      )
    } finally {
      follower.cleanup()
    }
  })

  it('recognizes uv+uvx (github-release/tar.gz source, real machine fixture) and records both binaries', async () => {
    writeExecutable(fixture, '.local/bin', 'uv')
    writeExecutable(fixture, '.local/bin', 'uvx')

    const report = await captureBinaries(fixture.ctx, { dryRun: false })
    expect(report.added).toBe(1)

    const manifest = effectiveLayer(fixture.ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS)
    const entries = (manifest.binary as BinaryEntry[]) ?? []
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('uv')
    expect(entries[0].source.kind).toBe('github-release')
    expect([...entries[0].binaries].sort()).toEqual(['uv', 'uvx'])
    expect(entries[0].pin).toBeFalsy()
  })

  it('records only the subset actually found when uvx is missing (never hardcodes the full registry list)', async () => {
    writeExecutable(fixture, '.local/bin', 'uv')

    await captureBinaries(fixture.ctx, { dryRun: false })
    const manifest = effectiveLayer(fixture.ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS)
    const entries = (manifest.binary as BinaryEntry[]) ?? []
    expect(entries[0].binaries).toEqual(['uv'])
  })

  it('recognizes micromamba (github-release/single-binary source, real machine fixture)', async () => {
    writeExecutable(fixture, '.local/bin', 'micromamba')

    const report = await captureBinaries(fixture.ctx, { dryRun: false })
    expect(report.added).toBe(1)

    const manifest = effectiveLayer(fixture.ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS)
    const entries = (manifest.binary as BinaryEntry[]) ?? []
    expect(entries[0].name).toBe('micromamba')
    if (entries[0].source.kind === 'github-release') {
      expect(entries[0].source.coordinate).toBe('mamba-org/micromamba-releases')
      expect(entries[0].source.assetKind).toBe('single-binary')
    }
  })

  it('skips (with a note) an unknown executable not in the registry -- never guesses a source', async () => {
    writeExecutable(fixture, '.local/bin', 'sync-claude-to-opencode.sh')

    const report = await captureBinaries(fixture.ctx, { dryRun: false })
    expect(report.added).toBe(0)
    expect(report.notes.some((n) => n.includes('sync-claude-to-opencode.sh'))).toBe(true)

    const manifest = effectiveLayer(fixture.ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS)
    expect((manifest.binary as BinaryEntry[] | undefined) ?? []).toHaveLength(0)
  })

  it('preserves an existing pin across recapture (capture never touches pin)', async () => {
    writeExecutable(fixture, '.local/bin', 'micromamba')

    await captureBinaries(fixture.ctx, { dryRun: false })
    const before = effectiveLayer(fixture.ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS)
      .binary as BinaryEntry[]
    expect(before[0].pin).toBeFalsy()

    const { writeCommonLayer } = await import('../../manifest')
    writeCommonLayer(fixture.ctx, BINARIES_LAYER, {
      binary: [{ ...before[0], pin: '2.3.3' }]
    })

    await captureBinaries(fixture.ctx, { dryRun: false })
    const after = effectiveLayer(fixture.ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS)
      .binary as BinaryEntry[]
    expect(after[0].pin).toBe('2.3.3')
  })

  it('dry-run computes counts but writes nothing to the manifest', async () => {
    writeExecutable(fixture, '.local/bin', 'uv')

    await captureBinaries(fixture.ctx, { dryRun: true })
    const manifest = effectiveLayer(fixture.ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS)
    expect((manifest.binary as BinaryEntry[] | undefined) ?? []).toHaveLength(0)
  })

  it(
    '실사례(코디네이터 확인): ~/micromamba/envs/<name>/bin/uv(다른 버전) 같은 conda/micromamba ' +
      '환경 스코프 실행파일은 capture가 절대 스캔·기록하지 않는다 -- installDir(기본 ' +
      '~/.local/bin)만 관리 대상이라 환경 안 버전 차이가 drift로 잘못 보고되지 않는다',
    async () => {
      writeExecutable(fixture, '.local/bin', 'uv') // 전역 0.11.2 격
      writeExecutable(fixture, 'micromamba/envs/yolo26pose/bin', 'uv') // 환경 스코프 0.10.4 격
      writeExecutable(fixture, 'micromamba/bin', 'uvicorn') // micromamba base엔 uv가 없다(실사례)

      const report = await captureBinaries(fixture.ctx, { dryRun: false })
      expect(report.added).toBe(1)
      expect(report.notes).toEqual([])

      const manifest = effectiveLayer(fixture.ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS)
      const entries = (manifest.binary as BinaryEntry[]) ?? []
      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('uv')
      expect(entries[0].binaries).toEqual(['uv'])
    }
  )
})
