import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RigsyncContext } from './context'
import { readIgnoreSet } from './ignore'
import { writeCommonLayer, writeManifestFile, hostLayerPath } from './manifest'

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
      settings: {}
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
