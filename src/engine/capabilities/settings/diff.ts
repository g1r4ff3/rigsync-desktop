/**
 * settings(dconf) diff — 구 repo `diff_dconf`(rigsync.py:1506) 행동 이식.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { effectiveLayer } from '../../manifest'
import { SETTINGS_KEY_FIELDS, SETTINGS_LAYER } from './constants'
import type { DconfProvider } from './providerTypes'
import type { SettingsDiffReport, SettingsManifest } from './types'

export async function diffSettings(
  ctx: RigsyncContext,
  provider: DconfProvider
): Promise<SettingsDiffReport> {
  if (!provider.isAvailable()) {
    return { skipped: true, contentChanged: [] }
  }

  const manifest = effectiveLayer(ctx, SETTINGS_LAYER, SETTINGS_KEY_FIELDS) as SettingsManifest
  const contentChanged: string[] = []
  for (const e of manifest.path ?? []) {
    const live = await provider.dump(e.path)
    const storedPath = path.join(ctx.manifestDir, e.file)
    const stored = fs.existsSync(storedPath) ? fs.readFileSync(storedPath, 'utf-8') : ''
    if (live !== stored) contentChanged.push(e.path)
  }
  return { skipped: false, contentChanged }
}
