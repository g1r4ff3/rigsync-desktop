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

  // 실사용 회귀(2026-07-27): naver/d2-coding-font 1.3.3부터 배포되는
  // .ttc·-ligature·-all 변종을 구 정규식(.ttf만)이 못 알아봐 diff의 variant
  // 판정 경로를 못 타는 바람에 재-diff가 영원히 수렴하지 않았다.
  const D2CODING_133_FILES = [
    'D2Coding-Ver1.3.3-20240524.ttf',
    'D2CodingBold-Ver1.3.3-20240524.ttf',
    'D2Coding-Ver1.3.3-20240524.ttc',
    'D2CodingBold-Ver1.3.3-20240524.ttc',
    'D2Coding-Ver1.3.3-20240524-ligature.ttf',
    'D2CodingBold-Ver1.3.3-20240524-ligature.ttf',
    'D2Coding-Ver1.3.3-20240524-ligature.ttc'
  ]

  it('recognizes all seven D2Coding 1.3.3 files (.ttc/-ligature variants included)', () => {
    for (const filename of D2CODING_133_FILES) {
      expect(identifyFontFamily(filename)?.name).toBe('D2Coding')
    }
  })

  it('variantKey distinguishes .ttc/-ligature from plain .ttf (so diff does not conflate them)', () => {
    const def = getKnownFontDefinition('D2Coding')
    expect(def?.variantKey?.('D2Coding-Ver1.3.3-20240524.ttf')).toBe('D2Coding.ttf')
    expect(def?.variantKey?.('D2CodingBold-Ver1.3.3-20240524.ttf')).toBe('D2CodingBold.ttf')
    expect(def?.variantKey?.('D2Coding-Ver1.3.3-20240524.ttc')).toBe('D2Coding.ttc')
    expect(def?.variantKey?.('D2CodingBold-Ver1.3.3-20240524-ligature.ttf')).toBe(
      'D2CodingBold-ligature.ttf'
    )
    expect(def?.variantKey?.('D2Coding-Ver1.3.3-20240524-ligature.ttc')).toBe(
      'D2Coding-ligature.ttc'
    )
    // 같은 variant는 버전이 달라도(1.3.2 vs 1.3.3) 동일한 키로 수렴한다.
    expect(def?.variantKey?.('D2Coding-Ver1.3.2-20180524.ttf')).toBe('D2Coding.ttf')
  })

  it('extractVersion reads the version-date segment for every 1.3.3 variant', () => {
    const def = getKnownFontDefinition('D2Coding')
    for (const filename of D2CODING_133_FILES) {
      expect(def?.extractVersion?.(filename)).toBe('1.3.3-20240524')
    }
  })

  it('D2Coding source coordinate points at the current repo (naver/d2-coding-font)', () => {
    const def = getKnownFontDefinition('D2Coding')
    expect(def?.source.kind).toBe('github-release')
    if (def?.source.kind === 'github-release') {
      expect(def.source.coordinate).toBe('naver/d2-coding-font')
    }
  })
})
