import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RigsyncContext } from './context'
import { readIgnoreSet, setIgnored, setIgnoredBulk } from './ignore'
import { readCommonLayer, writeCommonLayer, writeManifestFile, hostLayerPath } from './manifest'

// 케이스 출처: 구 repo tests/test_ignore.py TestIgnoreHostOverlayUnion
// (행동만 옮김 — 코드 복사 아님).

describe('readIgnoreSet', () => {
  let root: string
  let ctx: RigsyncContext

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-ignore-test-'))
    ctx = {
      machineId: 'testhost',
      role: 'reference',
      manifestDir: path.join(root, 'manifest'),
      homeDir: path.join(root, 'home'),
      backupRoot: path.join(root, 'home', '.rigsync-backup'),
      aptBaselinePath: path.join(
        root,
        'home',
        '.local',
        'share',
        'rigsync-desktop',
        'apt-baseline.txt'
      ),
      settings: {},
      autostartEnabled: false
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  // test_host_overlay_adds_to_common_not_replace
  it('unions a host-overlay ignore list onto common, does not replace it', () => {
    writeCommonLayer(ctx, 'ignore', { apt: { packages: ['unityhub'], sources: [] } })
    writeManifestFile(hostLayerPath(ctx, 'ignore'), { apt: { packages: ['zoom'], sources: [] } })

    const ignored = readIgnoreSet(ctx, 'apt', 'packages')
    expect(ignored).toEqual(new Set(['unityhub', 'zoom']))
  })

  // test_host_overlay_dotfiles_union
  it('unions host+common ignore lists for a different capability (dotfiles)', () => {
    writeCommonLayer(ctx, 'ignore', { dotfiles: { homes: ['~/a'] } })
    writeManifestFile(hostLayerPath(ctx, 'ignore'), { dotfiles: { homes: ['~/b'] } })

    const ignored = readIgnoreSet(ctx, 'dotfiles', 'homes')
    expect(ignored).toEqual(new Set(['~/a', '~/b']))
  })

  it('returns an empty set when nothing is ignored', () => {
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set())
  })
})

describe('setIgnoredBulk', () => {
  let root: string
  let ctx: RigsyncContext

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-ignore-bulk-test-'))
    ctx = {
      machineId: 'testhost',
      role: 'reference',
      manifestDir: path.join(root, 'manifest'),
      homeDir: path.join(root, 'home'),
      backupRoot: path.join(root, 'home', '.rigsync-backup'),
      aptBaselinePath: path.join(
        root,
        'home',
        '.local',
        'share',
        'rigsync-desktop',
        'apt-baseline.txt'
      ),
      settings: {},
      autostartEnabled: false
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('ignores every key in one call', () => {
    setIgnoredBulk(ctx, 'apt', 'packages', ['git', 'curl', 'vim'], true)
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set(['curl', 'git', 'vim']))
  })

  it('un-ignores every key in one call, leaving unrelated keys untouched', () => {
    setIgnoredBulk(ctx, 'apt', 'packages', ['git', 'curl', 'vim', 'zoom'], true)
    setIgnoredBulk(ctx, 'apt', 'packages', ['git', 'curl'], false)
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set(['vim', 'zoom']))
  })

  it('is a no-op for an empty key list (does not touch the file at all)', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    setIgnoredBulk(ctx, 'apt', 'packages', [], true)
    expect(writeSpy).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })

  it('performs exactly one read and one write regardless of how many keys are toggled (no per-item commit bomb)', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync')
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    setIgnoredBulk(ctx, 'apt', 'packages', ['a', 'b', 'c', 'd', 'e'], true)
    // ignore.toml 자체에 대한 읽기/쓰기는 각 1회여야 한다(다른 파일 IO가 섞여
    // 있을 수 있으니 ignore.toml 경로로 필터링).
    const ignorePathCallCount = (calls: readonly unknown[][]): number =>
      calls.filter((args) => String(args[0]).endsWith('ignore.toml')).length
    expect(ignorePathCallCount(readSpy.mock.calls)).toBeLessThanOrEqual(1)
    expect(ignorePathCallCount(writeSpy.mock.calls)).toBe(1)
    readSpy.mockRestore()
    writeSpy.mockRestore()
  })

  it('setIgnored (single-item) is expressed in terms of setIgnoredBulk and still works standalone', () => {
    setIgnored(ctx, 'flatpak', 'apps', 'org.deskflow.deskflow', true)
    expect(readIgnoreSet(ctx, 'flatpak', 'apps')).toEqual(new Set(['org.deskflow.deskflow']))
  })

  it('writes the common ignore.toml layer only (not a host overlay)', () => {
    setIgnoredBulk(ctx, 'apt', 'packages', ['git'], true)
    const doc = readCommonLayer(ctx, 'ignore') as { apt?: { packages?: string[] } }
    expect(doc.apt?.packages).toEqual(['git'])
  })
})
