import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { captureSettings, FollowerSettingsCaptureBlockedError } from './capture'
import { readCommonLayer } from '../../manifest'
import { SETTINGS_LAYER } from './constants'
import { makeFakeDconfProvider } from './testHelpers'
import type { SettingsManifest } from './types'

// 케이스 출처: 구 repo rigsync.py capture_dconf 행동(코드 복사 아님).

describe('captureSettings', () => {
  it('rejects capture on a follower machine', async () => {
    const fixture = makeFixture('follower', {
      settings: { dconfPaths: ['/org/gnome/desktop/wm/keybindings'] }
    })
    const provider = makeFakeDconfProvider({ dumps: { '/org/gnome/desktop/wm/keybindings': 'x' } })
    await expect(captureSettings(fixture.ctx, provider, { dryRun: false })).rejects.toThrow(
      FollowerSettingsCaptureBlockedError
    )
    fixture.cleanup()
  })

  it('reports skipped when dconf is unavailable', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeDconfProvider({ available: false })
    const report = await captureSettings(fixture.ctx, provider, { dryRun: false })
    expect(report.skipped).toBe(true)
    fixture.cleanup()
  })

  it('captures a non-empty path and writes the dump under settings/dconf/', async () => {
    const path1 = '/org/gnome/desktop/wm/keybindings'
    const fixture = makeFixture('reference', { settings: { dconfPaths: [path1] } })
    const provider = makeFakeDconfProvider({ dumps: { [path1]: '[/]\nclose=[]\n' } })
    const report = await captureSettings(fixture.ctx, provider, { dryRun: false })
    expect(report.written).toBe(1)
    expect(report.skippedEmpty).toEqual([])

    const manifest = readCommonLayer(fixture.ctx, SETTINGS_LAYER) as SettingsManifest
    expect(manifest.path).toHaveLength(1)
    expect(manifest.path?.[0].path).toBe(path1)
    const stored = fs.readFileSync(
      path.join(fixture.ctx.manifestDir, manifest.path![0].file),
      'utf-8'
    )
    expect(stored).toBe('[/]\nclose=[]\n')
    fixture.cleanup()
  })

  it('skips (does not capture) a path whose dump is empty', async () => {
    const path1 = '/org/gnome/empty/path'
    const fixture = makeFixture('reference', { settings: { dconfPaths: [path1] } })
    const provider = makeFakeDconfProvider({ dumps: { [path1]: '' } })
    const report = await captureSettings(fixture.ctx, provider, { dryRun: false })
    expect(report.written).toBe(0)
    expect(report.skippedEmpty).toEqual([path1])
    const manifest = readCommonLayer(fixture.ctx, SETTINGS_LAYER) as SettingsManifest
    expect(manifest.path ?? []).toEqual([])
    fixture.cleanup()
  })

  it('dry-run computes counts but writes nothing to the manifest', async () => {
    const path1 = '/org/gnome/desktop/wm/keybindings'
    const fixture = makeFixture('reference', { settings: { dconfPaths: [path1] } })
    const provider = makeFakeDconfProvider({ dumps: { [path1]: '[/]\nclose=[]\n' } })
    const report = await captureSettings(fixture.ctx, provider, { dryRun: true })
    expect(report.written).toBe(1)
    const manifest = readCommonLayer(fixture.ctx, SETTINGS_LAYER) as SettingsManifest
    expect(manifest.path ?? []).toEqual([])
    fixture.cleanup()
  })
})
