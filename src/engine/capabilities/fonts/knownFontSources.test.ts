import { describe, expect, it } from 'vitest'
import { getKnownFontDefinition, identifyFontFamily } from './knownFontSources'

describe('identifyFontFamily', () => {
  it('recognizes all four MesloLGS NF variants (real machine fixture filenames)', () => {
    for (const filename of [
      'MesloLGS NF Regular.ttf',
      'MesloLGS NF Bold.ttf',
      'MesloLGS NF Italic.ttf',
      'MesloLGS NF Bold Italic.ttf'
    ]) {
      expect(identifyFontFamily(filename)?.name).toBe('MesloLGS NF')
    }
  })

  it('recognizes D2Coding regular and bold variants (real machine fixture filenames)', () => {
    expect(identifyFontFamily('D2Coding-Ver1.3.2-20180524.ttf')?.name).toBe('D2Coding')
    expect(identifyFontFamily('D2CodingBold-Ver1.3.2-20180524.ttf')?.name).toBe('D2Coding')
  })

  it('returns null for an unrecognized font file -- never guesses', () => {
    expect(identifyFontFamily('Arial.ttf')).toBeNull()
    expect(identifyFontFamily('SomeRandomFont.otf')).toBeNull()
  })

  it('extracts the version embedded in a D2Coding filename', () => {
    const def = getKnownFontDefinition('D2Coding')
    expect(def?.extractVersion?.('D2Coding-Ver1.3.2-20180524.ttf')).toBe('1.3.2-20180524')
    expect(def?.extractVersion?.('D2CodingBold-Ver1.3.3-20260725.ttf')).toBe('1.3.3-20260725')
  })

  it('MesloLGS NF has no version extractor (static source, no versioning concept)', () => {
    const def = getKnownFontDefinition('MesloLGS NF')
    expect(def?.extractVersion).toBeUndefined()
  })

  it('getKnownFontDefinition returns null for an unregistered name', () => {
    expect(getKnownFontDefinition('Comic Sans')).toBeNull()
  })
})
