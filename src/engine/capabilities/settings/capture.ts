/**
 * settings(dconf) capture — 구 repo `capture_dconf`(rigsync.py:1479) 행동 이식.
 * 감시할 경로 목록은 `ctx.settings.dconfPaths`(구 repo
 * `cfg.setting("dconf","paths",default=[])`)에서 온다. dump가 빈 문자열이면
 * (그 경로에 아무 키도 없음) 캡처하지 않는다 — 구 repo와 동일한 "probe-first"
 * 관례(seed류와 같은 정신: 실제로 있는 것만 기록).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { readCommonLayer, writeCommonLayer } from '../../manifest'
import { SETTINGS_LAYER } from './constants'
import type { DconfProvider } from './providerTypes'
import type { DconfPathEntry, SettingsCaptureReport, SettingsManifest } from './types'

export class FollowerSettingsCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerSettingsCaptureBlockedError'
  }
}

export interface CaptureSettingsOptions {
  readonly dryRun: boolean
}

function dconfSlug(dconfPath: string): string {
  return dconfPath
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .join('-')
}

export async function captureSettings(
  ctx: RigsyncContext,
  provider: DconfProvider,
  options: CaptureSettingsOptions
): Promise<SettingsCaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerSettingsCaptureBlockedError()
  }
  if (!provider.isAvailable()) {
    return { skipped: true, written: 0, skippedEmpty: [] }
  }

  const paths = ctx.settings.dconfPaths ?? []
  const existing = (readCommonLayer(ctx, SETTINGS_LAYER) as SettingsManifest).path ?? []
  const entries = new Map<string, DconfPathEntry>(existing.map((e) => [e.path, e]))
  const outDir = path.join(ctx.manifestDir, 'settings', 'dconf')
  const skippedEmpty: string[] = []
  let written = 0

  for (const p of paths) {
    const dump = await provider.dump(p)
    if (!dump.trim()) {
      skippedEmpty.push(p)
      continue
    }
    const slug = dconfSlug(p)
    const rel = `settings/dconf/${slug}.ini`
    if (!options.dryRun) {
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, `${slug}.ini`), dump)
    }
    entries.set(p, { path: p, file: rel })
    written += 1
  }

  if (!options.dryRun) {
    writeCommonLayer(ctx, SETTINGS_LAYER, entries.size > 0 ? { path: [...entries.values()] } : {})
  }

  return { skipped: false, written, skippedEmpty }
}
