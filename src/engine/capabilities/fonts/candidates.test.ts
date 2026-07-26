import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture, writeIgnore, type TestFixture } from '../../testFixtures'
import { buildFontsSyncGroup } from './candidates'
import { FONTS_LAYER } from './constants'

function writeFontFile(fixture: TestFixture, filename: string): void {
  const dir = path.join(fixture.homeDir, '.local', 'share', 'fonts')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, filename), 'fake-font-bytes')
}

describe('buildFontsSyncGroup', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('returns null when there is nothing managed or installed', async () => {
    expect(await buildFontsSyncGroup(fixture.ctx)).toBeNull()
  })

  it('lists a managed font not yet installed as managed=true with no description', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'MesloLGS NF',
          source: { kind: 'static', urls: [] },
          files: ['MesloLGS NF Regular.ttf']
        }
      ]
    })
    const group = await buildFontsSyncGroup(fixture.ctx)
    expect(group?.items).toEqual([
      {
        key: 'MesloLGS NF',
        label: 'MesloLGS NF',
        managed: true,
        ignored: false,
        description: undefined
      }
    ])
  })

  it('lists an installed-but-unmanaged known font with a file-count description', async () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeFontFile(fixture, 'MesloLGS NF Bold.ttf')
    const group = await buildFontsSyncGroup(fixture.ctx)
    expect(group?.items).toEqual([
      {
        key: 'MesloLGS NF',
        label: 'MesloLGS NF',
        managed: false,
        ignored: false,
        description: '2개 파일 설치됨'
      }
    ])
  })

  it('respects the ignore set', async () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeIgnore(fixture, { fonts: { names: ['MesloLGS NF'] } })
    const group = await buildFontsSyncGroup(fixture.ctx)
    expect(group?.items[0].ignored).toBe(true)
  })
})
