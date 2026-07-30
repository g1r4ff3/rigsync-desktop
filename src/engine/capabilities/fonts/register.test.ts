import { describe, expect, it } from 'vitest'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { makeFixture, writeHomeFile, type TestFixture } from '../../testFixtures'
import { FONTS_LAYER } from './constants'
import { FontSourceUnknownError, registerFontEntry } from './register'
import type { FontEntry } from './types'

function fontEntriesOf(fixture: TestFixture): FontEntry[] {
  const doc = readCommonLayer(fixture.ctx, FONTS_LAYER)
  return (doc.font as FontEntry[] | undefined) ?? []
}

function seedMesloFiles(fixture: TestFixture): void {
  for (const variant of ['Regular', 'Bold', 'Italic', 'Bold Italic']) {
    writeHomeFile(fixture, `.local/share/fonts/MesloLGS NF ${variant}.ttf`, 'font bytes')
  }
}

describe('registerFontEntry', () => {
  it('레지스트리로 식별되는 설치 파일이 있으면 common fonts.toml에 upsert한다', () => {
    const fixture = makeFixture('reference')
    seedMesloFiles(fixture)

    registerFontEntry(fixture.ctx, 'MesloLGS NF')

    const entries = fontEntriesOf(fixture)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('MesloLGS NF')
    expect(entries[0].source).toEqual({
      kind: 'static',
      urls: expect.arrayContaining([expect.stringContaining('MesloLGS')])
    })
    expect([...entries[0].files].sort()).toEqual(
      [
        'MesloLGS NF Bold Italic.ttf',
        'MesloLGS NF Bold.ttf',
        'MesloLGS NF Italic.ttf',
        'MesloLGS NF Regular.ttf'
      ].sort()
    )
    fixture.cleanup()
  })

  it('레지스트리에 없는 이름은 좌표를 추정하지 않고 거부한다', () => {
    const fixture = makeFixture('reference')

    expect(() => registerFontEntry(fixture.ctx, 'Some Unknown Font')).toThrow(
      FontSourceUnknownError
    )
    expect(fontEntriesOf(fixture)).toHaveLength(0)
    fixture.cleanup()
  })

  it('기존 pin은 재등록해도 보존한다', () => {
    const fixture = makeFixture('reference')
    seedMesloFiles(fixture)

    registerFontEntry(fixture.ctx, 'MesloLGS NF')
    const entries = fontEntriesOf(fixture).map((e) =>
      e.name === 'MesloLGS NF' ? { ...e, pin: '1.0' } : e
    )
    writeCommonLayer(fixture.ctx, FONTS_LAYER, { font: entries })

    registerFontEntry(fixture.ctx, 'MesloLGS NF')

    expect(fontEntriesOf(fixture)[0].pin).toBe('1.0')
    fixture.cleanup()
  })
})
