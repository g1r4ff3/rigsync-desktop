/**
 * apply → diff 수렴 e2e 테스트 — 실사용 버그(follower 머신에서 Apply가 전부
 * ok로 끝나도 화면을 새로고쳐도 같은 폰트가 영원히 to-install로 남는 문제)의
 * 재발 방지. 두 축을 함께 고정한다:
 * ① D2Coding처럼 release asset 파일명에 버전이 박혀 최신 버전이 매번 바뀌는
 *    경우에도, apply가 실제로 설치한 파일로 재-diff하면 drift 0이 돼야 한다
 *    (`diff.ts`의 variant 단위 판정으로 고침 — 정확한 파일명 일치는 이 소스
 *    종류에서 구조적으로 영원히 수렴하지 않았다).
 * ② 폰트 배치 위치(평면 vs apply가 실제로 쓰는 `~/.local/share/fonts/<name>/`
 *    하위 디렉터리) 둘 다 설치됨으로 인식돼야 한다 — 기존 머신(reference)은
 *    평면, 신규 apply 설치는 하위 디렉터리다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { FONTS_LAYER } from './constants'
import { diffFonts } from './diff'
import { planFonts } from './plan'
import { fontInstallDir } from './scan'
import type { ZipExtractor, ZipExtractResult } from './providerTypes'
import {
  makeFakeFontAssetResolver,
  makeFakeFontDownloader,
  makeFakeFontsSystemProvider
} from './testHelpers'

function writeD2CodingManifest(fixture: TestFixture): void {
  writeCommonLayer(fixture.ctx, FONTS_LAYER, {
    font: [
      {
        name: 'D2Coding',
        source: {
          kind: 'github-release',
          coordinate: 'naver/d2codingfont',
          assetPattern: 'D2Coding-Ver*.zip'
        },
        // 실사용 manifest 그대로 -- reference 머신이 2018년에 캡처한 버전.
        files: ['D2Coding-Ver1.3.2-20180524.ttf', 'D2CodingBold-Ver1.3.2-20180524.ttf']
      }
    ]
  })
}

/** 실제 apply처럼 destDir에 진짜 폰트 파일을 쓰는 zip extractor 페이크. */
function makeWritingZipExtractor(filenames: readonly string[]): ZipExtractor {
  return {
    extract: (_zipPath, destDir): ZipExtractResult => {
      fs.mkdirSync(destDir, { recursive: true })
      const extractedPaths = filenames.map((name) => {
        const dest = path.join(destDir, name)
        fs.writeFileSync(dest, 'fake-font-bytes')
        return dest
      })
      return { ok: true, extractedPaths }
    }
  }
}

describe('fonts apply -> diff convergence (실사용 버그 회귀)', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('github-release 폰트: apply가 최신 버전 파일명으로 설치해도 재-diff에서 drift 0', async () => {
    writeD2CodingManifest(fixture)
    const diff1 = await diffFonts(fixture.ctx)
    expect(diff1.toInstall).toEqual(['D2Coding'])

    const resolver = makeFakeFontAssetResolver({
      assetsByCoordinate: {
        'naver/d2codingfont': {
          name: 'D2Coding-Ver1.3.3-20260725.zip',
          downloadUrl: 'https://example.com/D2Coding-Ver1.3.3-20260725.zip'
        }
      }
    })
    // 실사용과 동일하게 release는 항상 최신(1.3.3)을 낸다 -- manifest의 files는
    // 여전히 1.3.2로 남아 있다.
    const zipExtractor = makeWritingZipExtractor([
      'D2Coding-Ver1.3.3-20260725.ttf',
      'D2CodingBold-Ver1.3.3-20260725.ttf'
    ])
    const actions = planFonts(
      fixture.ctx,
      diff1,
      resolver,
      makeFakeFontDownloader(),
      zipExtractor,
      makeFakeFontsSystemProvider(),
      'run1'
    )
    expect(actions).toHaveLength(1)
    const result = await actions[0].run()
    expect(result.ok).toBe(true)

    const diff2 = await diffFonts(fixture.ctx)
    expect(diff2.toInstall).toEqual([])
    expect(
      planFonts(
        fixture.ctx,
        diff2,
        resolver,
        makeFakeFontDownloader(),
        zipExtractor,
        makeFakeFontsSystemProvider(),
        'run2'
      )
    ).toEqual([])
  })

  it('pin이 걸린 경우엔 variant가 설치돼 있어도 버전 불일치를 계속 보고한다 (pin 의미 보존)', async () => {
    writeCommonLayer(fixture.ctx, FONTS_LAYER, {
      font: [
        {
          name: 'D2Coding',
          source: {
            kind: 'github-release',
            coordinate: 'naver/d2codingfont',
            assetPattern: 'D2Coding-Ver*.zip'
          },
          files: ['D2Coding-Ver1.3.2-20180524.ttf', 'D2CodingBold-Ver1.3.2-20180524.ttf'],
          pin: '1.3.2-20180524'
        }
      ]
    })
    const dir = path.join(fixture.homeDir, '.local', 'share', 'fonts')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'D2Coding-Ver1.3.3-20260725.ttf'), 'x')
    fs.writeFileSync(path.join(dir, 'D2CodingBold-Ver1.3.3-20260725.ttf'), 'x')

    const diff = await diffFonts(fixture.ctx)
    // variant(비Bold/Bold)는 둘 다 설치돼 있으니 toInstall은 아니다.
    expect(diff.toInstall).toEqual([])
    // 그러나 pin(1.3.2)과 실제 설치된 버전(1.3.3)이 다르므로 pinMismatch로 남아야
    // 한다 -- variant 판정으로 바꿨다고 pin의 "버전 고정" 의미가 사라지면 안 된다.
    expect(diff.pinMismatch).toEqual([
      { name: 'D2Coding', pinned: '1.3.2-20180524', installedVersion: '1.3.3-20260725' }
    ])
  })

  it('평면 배치(기존 머신)와 하위 디렉터리 배치(신규 apply 설치) 둘 다 설치됨으로 판정', async () => {
    writeD2CodingManifest(fixture)

    const flatDir = path.join(fixture.homeDir, '.local', 'share', 'fonts')
    fs.mkdirSync(flatDir, { recursive: true })
    fs.writeFileSync(path.join(flatDir, 'D2Coding-Ver1.3.3-20260725.ttf'), 'x')
    fs.writeFileSync(path.join(flatDir, 'D2CodingBold-Ver1.3.3-20260725.ttf'), 'x')

    const diffFlat = await diffFonts(fixture.ctx)
    expect(diffFlat.toInstall).toEqual([])

    fs.rmSync(flatDir, { recursive: true, force: true })
    const subDir = fontInstallDir(fixture.ctx, 'D2Coding')
    fs.mkdirSync(subDir, { recursive: true })
    fs.writeFileSync(path.join(subDir, 'D2Coding-Ver1.3.3-20260725.ttf'), 'x')
    fs.writeFileSync(path.join(subDir, 'D2CodingBold-Ver1.3.3-20260725.ttf'), 'x')

    const diffSub = await diffFonts(fixture.ctx)
    expect(diffSub.toInstall).toEqual([])
  })
})
