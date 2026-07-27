import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectiveLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { captureFonts, FollowerFontsCaptureBlockedError } from './capture'
import { FONTS_KEY_FIELDS, FONTS_LAYER } from './constants'
import type { FontEntry } from './types'

function fontsDir(fixture: TestFixture): string {
  return path.join(fixture.homeDir, '.local', 'share', 'fonts')
}

function writeFontFile(fixture: TestFixture, filename: string): void {
  const dir = fontsDir(fixture)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), 'fake-font-bytes')
}

describe('captureFonts', () => {
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
      await expect(captureFonts(follower.ctx, { dryRun: false })).rejects.toThrow(
        FollowerFontsCaptureBlockedError
      )
    } finally {
      follower.cleanup()
    }
  })

  it('recognizes MesloLGS NF (static source, real machine fixture) and records the files actually found', async () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeFontFile(fixture, 'MesloLGS NF Bold.ttf')

    const report = await captureFonts(fixture.ctx, { dryRun: false })
    expect(report.added).toBe(1)

    const manifest = effectiveLayer(fixture.ctx, FONTS_LAYER, FONTS_KEY_FIELDS)
    const entries = (manifest.font as FontEntry[]) ?? []
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('MesloLGS NF')
    expect(entries[0].source.kind).toBe('static')
    // 2개만 실제로 발견됐으면 files도 2개만 기록한다 -- 하드코딩된 4개가 아니다.
    expect([...entries[0].files].sort()).toEqual(
      ['MesloLGS NF Bold.ttf', 'MesloLGS NF Regular.ttf'].sort()
    )
    expect(entries[0].pin).toBeFalsy()
  })

  it('recognizes D2Coding (github-release source, version embedded in filename, real machine fixture)', async () => {
    writeFontFile(fixture, 'D2Coding-Ver1.3.2-20180524.ttf')
    writeFontFile(fixture, 'D2CodingBold-Ver1.3.2-20180524.ttf')

    const report = await captureFonts(fixture.ctx, { dryRun: false })
    expect(report.added).toBe(1)

    const manifest = effectiveLayer(fixture.ctx, FONTS_LAYER, FONTS_KEY_FIELDS)
    const entries = (manifest.font as FontEntry[]) ?? []
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('D2Coding')
    expect(entries[0].source.kind).toBe('github-release')
    if (entries[0].source.kind === 'github-release') {
      expect(entries[0].source.coordinate).toBe('naver/d2-coding-font')
    }
    expect([...entries[0].files].sort()).toEqual(
      ['D2Coding-Ver1.3.2-20180524.ttf', 'D2CodingBold-Ver1.3.2-20180524.ttf'].sort()
    )
  })

  it('skips (with a note) an unknown font file not in the registry -- never guesses a source', async () => {
    writeFontFile(fixture, 'SomeRandomFont.ttf')

    const report = await captureFonts(fixture.ctx, { dryRun: false })
    expect(report.added).toBe(0)
    expect(report.notes.some((n) => n.includes('SomeRandomFont.ttf'))).toBe(true)
    // 버전성 파일명이 아니므로(F5) 수렴 경고는 붙지 않는다.
    expect(report.notes.some((n) => n.includes('수렴하지 않을 수 있음'))).toBe(false)

    const manifest = effectiveLayer(fixture.ctx, FONTS_LAYER, FONTS_KEY_FIELDS)
    expect((manifest.font as FontEntry[] | undefined) ?? []).toHaveLength(0)
  })

  it('flags an unknown, versioned font filename with the F5 non-convergence warning', async () => {
    writeFontFile(fixture, 'JetBrainsMono-2.304.ttf')

    const report = await captureFonts(fixture.ctx, { dryRun: false })
    expect(report.added).toBe(0)
    const note = report.notes.find((n) => n.includes('JetBrainsMono-2.304.ttf'))
    expect(note).toBeDefined()
    expect(note).toContain('수렴하지 않을 수 있음')
  })

  it('preserves an existing pin across recapture (capture never touches pin)', async () => {
    writeFontFile(fixture, 'D2Coding-Ver1.3.2-20180524.ttf')

    await captureFonts(fixture.ctx, { dryRun: false })
    const before = effectiveLayer(fixture.ctx, FONTS_LAYER, FONTS_KEY_FIELDS).font as FontEntry[]
    expect(before[0].pin).toBeFalsy()

    const { writeCommonLayer } = await import('../../manifest')
    writeCommonLayer(fixture.ctx, FONTS_LAYER, { font: [{ ...before[0], pin: '1.3.2-20180524' }] })

    await captureFonts(fixture.ctx, { dryRun: false })
    const after = effectiveLayer(fixture.ctx, FONTS_LAYER, FONTS_KEY_FIELDS).font as FontEntry[]
    expect(after[0].pin).toBe('1.3.2-20180524')
  })

  it('dry-run computes counts but writes nothing to the manifest', async () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')

    await captureFonts(fixture.ctx, { dryRun: true })
    const manifest = effectiveLayer(fixture.ctx, FONTS_LAYER, FONTS_KEY_FIELDS)
    expect((manifest.font as FontEntry[] | undefined) ?? []).toHaveLength(0)
  })

  it('also scans the legacy ~/.fonts directory when it exists', async () => {
    const legacyDir = path.join(fixture.homeDir, '.fonts')
    fs.mkdirSync(legacyDir, { recursive: true })
    fs.writeFileSync(path.join(legacyDir, 'MesloLGS NF Italic.ttf'), 'fake')

    const report = await captureFonts(fixture.ctx, { dryRun: false })
    expect(report.added).toBe(1)
    const manifest = effectiveLayer(fixture.ctx, FONTS_LAYER, FONTS_KEY_FIELDS)
    const entries = (manifest.font as FontEntry[]) ?? []
    expect(entries[0].files).toEqual(['MesloLGS NF Italic.ttf'])
  })
})
