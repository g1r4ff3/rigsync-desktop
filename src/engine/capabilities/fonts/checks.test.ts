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
    const warning = result.warnings.find((w) => w.includes('SomeRandomFont.ttf'))
    expect(warning).toBeDefined()
    // 버전성 파일명이 아니므로(F5) 수렴 경고 문구는 붙지 않는다.
    expect(warning).not.toContain('수렴하지 않을 수 있음')
  })

  it('appends the F5 non-convergence warning for an unresolved, versioned font filename', async () => {
    writeFontFile(fixture, 'JetBrainsMono-2.304.ttf')
    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(fixture.ctx, diff, makeFakeFontsSystemProvider())
    const warning = result.warnings.find((w) => w.includes('JetBrainsMono-2.304.ttf'))
    expect(warning).toBeDefined()
    expect(warning).toContain('수렴하지 않을 수 있음')
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

  // 실사용 회귀(follower lab-main, 2026-07-27): manifest에 source까지 선언된
  // 파일들(FiraCode 7종)이 하드코딩 레지스트리엔 없다는 이유만으로 전부
  // "알려진 레지스트리에 없어 재현 불가"로 오탐됐다 -- 식별의 1차 진실은
  // manifest여야 한다(checks.ts가 groupInstalledFontFiles에 manifest를 넘김).
  const FIRACODE_FILES = [
    'FiraCode-Regular.ttf',
    'FiraCode-Bold.ttf',
    'FiraCode-Medium.ttf',
    'FiraCode-Light.ttf',
    'FiraCode-Retina.ttf',
    'FiraCode-SemiBold.ttf',
    'FiraCode-VF.ttf'
  ]

  it('manifest에 선언된 FiraCode(레지스트리엔 없는 이름) 설치 파일은 unresolvedInstalled에 안 나온다', async () => {
    for (const file of FIRACODE_FILES) writeFontFile(fixture, file)
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'Fira Code',
          source: { kind: 'static', urls: [] },
          files: [...FIRACODE_FILES]
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(fixture.ctx, diff, makeFakeFontsSystemProvider())
    for (const file of FIRACODE_FILES) {
      expect(result.unresolvedInstalled).not.toContain(file)
    }
  })

  it('manifest에도 레지스트리에도 없는 파일은 여전히 unresolvedInstalled에 나온다', async () => {
    for (const file of FIRACODE_FILES) writeFontFile(fixture, file)
    writeFontFile(fixture, 'TrulyUnknownFont.ttf')
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'Fira Code',
          source: { kind: 'static', urls: [] },
          files: [...FIRACODE_FILES]
        }
      ]
    })
    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(fixture.ctx, diff, makeFakeFontsSystemProvider())
    expect(result.unresolvedInstalled).toEqual(['TrulyUnknownFont.ttf'])
  })

  it('같은 파일이 ~/.fonts와 ~/.local/share/fonts 양쪽에 있어도 경고는 한 번만 나온다', async () => {
    writeFontFile(fixture, 'DuplicatedUnknown.ttf')
    const legacyDir = path.join(fixture.homeDir, '.fonts')
    fs.mkdirSync(legacyDir, { recursive: true })
    fs.writeFileSync(path.join(legacyDir, 'DuplicatedUnknown.ttf'), 'fake-font-bytes')

    const diff = await diffFonts(fixture.ctx)
    const result = checkFontsPreflight(fixture.ctx, diff, makeFakeFontsSystemProvider())
    expect(result.unresolvedInstalled).toEqual(['DuplicatedUnknown.ttf'])
    const matching = result.warnings.filter((w) => w.includes('DuplicatedUnknown.ttf'))
    expect(matching).toHaveLength(1)
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
