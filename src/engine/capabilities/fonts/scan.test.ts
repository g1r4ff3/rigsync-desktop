import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { fontDirs, fontInstallDir, groupInstalledFontFiles, scanInstalledFontFiles } from './scan'

function writeFontFile(fixture: TestFixture, filename: string, dir?: string): void {
  const target = dir ?? path.join(fixture.homeDir, '.local', 'share', 'fonts')
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, filename), 'fake-font-bytes')
}

describe('fontDirs', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('always includes ~/.local/share/fonts', () => {
    expect(fontDirs(fixture.ctx)).toEqual([path.join(fixture.homeDir, '.local', 'share', 'fonts')])
  })

  it('includes ~/.fonts only when it exists', () => {
    fs.mkdirSync(path.join(fixture.homeDir, '.fonts'), { recursive: true })
    expect(fontDirs(fixture.ctx)).toEqual([
      path.join(fixture.homeDir, '.local', 'share', 'fonts'),
      path.join(fixture.homeDir, '.fonts')
    ])
  })
})

describe('fontInstallDir', () => {
  it('is a subdirectory of ~/.local/share/fonts named after the font', () => {
    const fixture = makeFixture('reference')
    expect(fontInstallDir(fixture.ctx, 'MesloLGS NF')).toBe(
      path.join(fixture.homeDir, '.local', 'share', 'fonts', 'MesloLGS NF')
    )
    fixture.cleanup()
  })
})

describe('scanInstalledFontFiles / groupInstalledFontFiles', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('scans font files recursively (apply installs into <name>/ subdirectories)', () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeFontFile(
      fixture,
      'D2Coding-Ver1.3.2-20180524.ttf',
      path.join(fixture.homeDir, '.local', 'share', 'fonts', 'D2Coding')
    )
    const files = scanInstalledFontFiles(fixture.ctx)
    expect(files.sort()).toEqual(
      ['MesloLGS NF Regular.ttf', 'D2Coding-Ver1.3.2-20180524.ttf'].sort()
    )
  })

  it('ignores non-font files', () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeFontFile(fixture, 'readme.txt')
    expect(scanInstalledFontFiles(fixture.ctx)).toEqual(['MesloLGS NF Regular.ttf'])
  })

  it('groups resolved files by family name and separates unresolved files', () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeFontFile(fixture, 'MesloLGS NF Bold.ttf')
    writeFontFile(fixture, 'SomeRandomFont.ttf')
    const { resolvedByName, unresolvedFiles } = groupInstalledFontFiles(fixture.ctx)
    expect(resolvedByName.get('MesloLGS NF')?.sort()).toEqual(
      ['MesloLGS NF Bold.ttf', 'MesloLGS NF Regular.ttf'].sort()
    )
    expect(unresolvedFiles).toEqual(['SomeRandomFont.ttf'])
  })

  it('returns empty results when no fonts directory exists', () => {
    expect(scanInstalledFontFiles(fixture.ctx)).toEqual([])
    const { resolvedByName, unresolvedFiles } = groupInstalledFontFiles(fixture.ctx)
    expect(resolvedByName.size).toBe(0)
    expect(unresolvedFiles).toEqual([])
  })

  // 실사용 회귀(2026-07-27): 식별의 1차 진실은 manifest여야 한다 -- 하드코딩
  // 레지스트리 패턴이 못 알아보는 파일이라도, manifest 엔트리의 files에 정확히
  // 선언돼 있으면 그 엔트리 소속으로 분류하고 unresolvedFiles에 남기지 않는다.
  it('classifies a manifest-declared file by manifest entry name even when no registry pattern matches it', () => {
    writeFontFile(fixture, 'D2Coding-Ver1.3.3-20240524-ligature.ttc')
    const { resolvedByName, unresolvedFiles } = groupInstalledFontFiles(fixture.ctx, [
      {
        name: 'D2Coding',
        source: { kind: 'github-release', coordinate: 'naver/d2-coding-font', assetPattern: '*' },
        files: ['D2Coding-Ver1.3.3-20240524-ligature.ttc']
      }
    ])
    expect(resolvedByName.get('D2Coding')).toEqual(['D2Coding-Ver1.3.3-20240524-ligature.ttc'])
    expect(unresolvedFiles).toEqual([])
  })

  it('classifies a manifest-declared file under an entirely unregistered family name (no registry entry at all)', () => {
    writeFontFile(fixture, 'FiraCode-Regular.ttf')
    const { resolvedByName, unresolvedFiles } = groupInstalledFontFiles(fixture.ctx, [
      {
        name: 'Fira Code',
        source: { kind: 'static', urls: [] },
        files: ['FiraCode-Regular.ttf']
      }
    ])
    expect(resolvedByName.get('Fira Code')).toEqual(['FiraCode-Regular.ttf'])
    expect(unresolvedFiles).toEqual([])
  })

  it('dedupes a filename that appears in both ~/.local/share/fonts and ~/.fonts', () => {
    writeFontFile(fixture, 'SomeRandomFont.ttf')
    writeFontFile(fixture, 'SomeRandomFont.ttf', path.join(fixture.homeDir, '.fonts'))
    const { unresolvedFiles } = groupInstalledFontFiles(fixture.ctx)
    expect(unresolvedFiles).toEqual(['SomeRandomFont.ttf'])
  })

  it('dedupes a resolved (registry-matched) filename duplicated across both font directories', () => {
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf')
    writeFontFile(fixture, 'MesloLGS NF Regular.ttf', path.join(fixture.homeDir, '.fonts'))
    const { resolvedByName } = groupInstalledFontFiles(fixture.ctx)
    expect(resolvedByName.get('MesloLGS NF')).toEqual(['MesloLGS NF Regular.ttf'])
  })
})
