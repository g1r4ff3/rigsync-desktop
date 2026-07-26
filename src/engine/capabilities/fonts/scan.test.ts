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
})
