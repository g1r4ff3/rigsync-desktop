import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { FONTS_LAYER } from './constants'
import { diffFonts } from './diff'

function writeFontFile(fixture: TestFixture, filename: string): void {
  const dir = path.join(fixture.homeDir, '.local', 'share', 'fonts')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), 'fake-font-bytes')
}

describe('diffFonts', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('reports toInstall when a manifested font is missing entirely', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: {
            kind: 'static',
            urls: ['https://example.com/MesloLGS%20NF%20Regular.ttf']
          },
          files: ['MesloLGS NF Regular.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    expect(diff.toInstall).toEqual(['MesloLGS NF'])
  })

  it('reports toInstall when only some declared files are present', async () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: { kind: 'static', urls: [] },
          files: ['MesloLGS NF Regular.ttf', 'MesloLGS NF Bold.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    expect(diff.toInstall).toEqual(['MesloLGS NF'])
  })

  it('is in sync when all declared files are installed', async () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeFontFile(fixture, 'MesloLGS NF Bold.ttf')
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: { kind: 'static', urls: [] },
          files: ['MesloLGS NF Regular.ttf', 'MesloLGS NF Bold.ttf']
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    expect(diff.toInstall).toEqual([])
    expect(diff.pinMismatch).toEqual([])
  })

  it('reports a pin mismatch when the installed file version differs from the pinned version', async () => {
    writeFontFile(fixture, 'D2Coding-Ver1.3.2-20180524.ttf')
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'D2Coding',
          source: { kind: 'github-release', coordinate: 'naver/d2codingfont', assetPattern: '*' },
          files: ['D2Coding-Ver1.3.2-20180524.ttf'],
          pin: '1.3.3-20260725'
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    expect(diff.toInstall).toEqual([])
    expect(diff.pinMismatch).toEqual([
      { name: 'D2Coding', pinned: '1.3.3-20260725', installedVersion: '1.3.2-20180524' }
    ])
  })

  it('reports an installed-but-unmanifested known font as uncaptured', async () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    const diff = await diffFonts(fixture.ctx)
    expect(diff.uncaptured).toEqual(['MesloLGS NF'])
  })

  it('does not surface unknown (unregistered) installed files as uncaptured -- they are not "captured-able" names', async () => {
    writeFontFile(fixture, 'SomeRandomFont.ttf')
    const diff = await diffFonts(fixture.ctx)
    expect(diff.uncaptured).toEqual([])
  })
})
