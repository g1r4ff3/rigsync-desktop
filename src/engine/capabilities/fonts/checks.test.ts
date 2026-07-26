import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { checkFontsPreflight } from './checks'
import { diffFonts } from './diff'
import { writeCommonLayer } from '../../manifest'
import { FONTS_LAYER } from './constants'
import { makeFakeFontsSystemProvider } from './testHelpers'

function writeFontFile(fixture: TestFixture, filename: string): void {
  const dir = path.join(fixture.homeDir, '.local', 'share', 'fonts')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), 'fake-font-bytes')
}

describe('checkFontsPreflight', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('warns about a manifested font missing from this machine', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: { kind: 'static', urls: [] },
          files: ['MesloLGS NF Regular.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(fixture.ctx, diff, makeFakeFontsSystemProvider())
    expect(result.missingInstalled).toEqual(['MesloLGS NF'])
    expect(result.warnings.some((w) => w.includes('MesloLGS NF'))).toBe(true)
  })

  it('warns about an installed font file with no known registry source (unresolved)', async () => {
    writeFontFile(fixture, 'SomeRandomFont.ttf')
    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(fixture.ctx, diff, makeFakeFontsSystemProvider())
    expect(result.unresolvedInstalled).toEqual(['SomeRandomFont.ttf'])
    expect(result.warnings.some((w) => w.includes('SomeRandomFont.ttf'))).toBe(true)
  })

  it('warns when fc-cache is unavailable', async () => {
    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(
      fixture.ctx,
      diff,
      makeFakeFontsSystemProvider({ fcCacheAvailable: false })
    )
    expect(result.fcCacheAvailable).toBe(false)
    expect(result.warnings.some((w) => w.includes('fc-cache'))).toBe(true)
  })

  it('warns when fc-list is unavailable', async () => {
    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(
      fixture.ctx,
      diff,
      makeFakeFontsSystemProvider({ fcListAvailable: false })
    )
    expect(result.fcListAvailable).toBe(false)
    expect(result.warnings.some((w) => w.includes('fc-list'))).toBe(true)
  })

  it('all green: known fonts fully installed, no unresolved files, tools available', async () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: { kind: 'static', urls: [] },
          files: ['MesloLGS NF Regular.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(fixture.ctx, diff, makeFakeFontsSystemProvider())
    expect(result.warnings).toEqual([])
  })
})
