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

  // 실사용 회귀(follower lab-main, 2026-07-27): manifest에 D2Coding 1.3.3의
  // .ttc·-ligature 변종을 포함한 7파일이 선언돼 있고 디스크에도 7파일 전부
  // 설치돼 있는데, Apply가 성공해도 재-diff가 영원히 toInstall: D2Coding을
  // 보고했다 -- 하드코딩 레지스트리 패턴이 .ttc·-ligature를 인식 못 해
  // variant 판정 경로 자체를 못 탔기 때문(diff.ts의 정확 일치 폴백으로 수정).
  const D2CODING_133_FILES = [
    'D2Coding-Ver1.3.3-20240524.ttf',
    'D2CodingBold-Ver1.3.3-20240524.ttf',
    'D2Coding-Ver1.3.3-20240524.ttc',
    'D2CodingBold-Ver1.3.3-20240524.ttc',
    'D2Coding-Ver1.3.3-20240524-ligature.ttf',
    'D2CodingBold-Ver1.3.3-20240524-ligature.ttf',
    'D2Coding-Ver1.3.3-20240524-ligature.ttc'
  ]

  function writeD2Coding133Manifest(files: readonly string[]): void {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'D2Coding',
          source: {
            kind: 'github-release',
            coordinate: 'naver/d2-coding-font',
            assetPattern: 'D2Coding-Ver*.zip'
          },
          files: [...files]
        }
      ]
    })
  }

  it('follower 회귀: manifest 7파일(.ttc·ligature 포함) 전부 설치돼 있으면 toInstall이 빈 배열', async () => {
    for (const file of D2CODING_133_FILES) writeFontFile(fixture, file)
    writeD2Coding133Manifest(D2CODING_133_FILES)
    const diff = await diffFonts(fixture.ctx)
    expect(diff.toInstall).toEqual([])
  })

  it('부분 설치(ligature .ttc 하나 누락)면 toInstall에 D2Coding이 남는다', async () => {
    const installed = D2CODING_133_FILES.filter(
      (f) => f !== 'D2Coding-Ver1.3.3-20240524-ligature.ttc'
    )
    for (const file of installed) writeFontFile(fixture, file)
    writeD2Coding133Manifest(D2CODING_133_FILES)
    const diff = await diffFonts(fixture.ctx)
    expect(diff.toInstall).toEqual(['D2Coding'])
  })

  it('버전 drift: 선언 1.3.3 .ttf인데 설치는 1.3.2 .ttf여도 variant 일치로 수렴한다(기존 동작 유지)', async () => {
    writeFontFile(fixture, 'D2Coding-Ver1.3.2-20180524.ttf')
    writeFontFile(fixture, 'D2CodingBold-Ver1.3.2-20180524.ttf')
    writeD2Coding133Manifest([
      'D2Coding-Ver1.3.3-20240524.ttf',
      'D2CodingBold-Ver1.3.3-20240524.ttf'
    ])
    const diff = await diffFonts(fixture.ctx)
    expect(diff.toInstall).toEqual([])
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
