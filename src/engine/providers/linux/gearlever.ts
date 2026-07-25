/**
 * 실제 Gear Lever 조회 — `GearLeverProvider`의 Linux 구현. dev 환경에서만
 * 쓰인다(테스트는 fake 주입). FORWARD.md §7 실측 반영: `--list-installed --json`
 * 은 `--help`에 안 나오는 숨은 플래그, config는
 * `~/.var/app/it.mijorus.gearlever/config/gearlever.conf`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gearleverConfigHash, parseIni } from '../../capabilities/appimage/ini'
import type {
  GearLeverAppConfig,
  GearLeverCommandResult,
  GearLeverInstalledRow,
  GearLeverProvider
} from '../../capabilities/appimage/providerTypes'
import type { UpdateManagerModel } from '../../capabilities/appimage/types'
import { commandExists, run } from './exec'

const GEARLEVER_APP_ID = 'it.mijorus.gearlever'

function configPath(): string {
  return path.join(os.homedir(), '.var', 'app', GEARLEVER_APP_ID, 'config', 'gearlever.conf')
}

interface RawInstalledRow {
  name: string
  path: string
  desktop_id: string
  current_version: string | null
  available_version: string | null
  download_size: number | null
  manager: string
  embedded_source: boolean
  running: boolean
}

function toBooleanIni(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  return value.trim().toLowerCase() === 'true'
}

export class LinuxGearLeverProvider implements GearLeverProvider {
  isAvailable(): boolean {
    if (!commandExists('flatpak')) return false
    const result = run(['flatpak', 'info', GEARLEVER_APP_ID])
    return result.code === 0
  }

  version(): string | null {
    const result = run(['flatpak', 'list', '--app', '--columns=application,version'])
    if (result.code !== 0) return null
    for (const line of result.stdout.split('\n')) {
      const [app, ver] = line.split('\t')
      if (app?.trim() === GEARLEVER_APP_ID) return ver?.trim() || null
    }
    return null
  }

  listInstalled(): GearLeverInstalledRow[] {
    // --json은 --help에 안 나오는 숨은 플래그 (FORWARD.md §7 실측).
    const result = run(['flatpak', 'run', GEARLEVER_APP_ID, '--list-installed', '--json'], 30_000)
    if (result.code !== 0) return []
    try {
      const parsed = JSON.parse(result.stdout) as { installed?: RawInstalledRow[] }
      return (parsed.installed ?? []).map((row) => ({
        name: row.name,
        path: row.path,
        desktopId: row.desktop_id,
        currentVersion: row.current_version,
        availableVersion: row.available_version,
        downloadSize: row.download_size,
        manager: row.manager,
        embeddedSource: row.embedded_source,
        running: row.running
      }))
    } catch {
      return []
    }
  }

  readAppConfig(appImagePath: string): GearLeverAppConfig | null {
    const file = configPath()
    if (!fs.existsSync(file)) return null
    const doc = parseIni(fs.readFileSync(file, 'utf-8'))
    const hash = gearleverConfigHash(appImagePath)
    const appSection = doc[`app.${hash}`]
    const umSection = doc[`app.${hash}.update_manager`]
    if (!appSection && !umSection) return null
    return {
      name: appSection?.name,
      filePath: appSection?.file_path,
      updateManager: umSection
        ? {
            repo: umSection.repo,
            repoFilename: umSection.repo_filename,
            manager: umSection.manager,
            allowPrereleases: toBooleanIni(umSection.allow_prereleases)
          }
        : undefined
    }
  }

  integrate(appImagePath: string): GearLeverCommandResult {
    const result = run(
      ['flatpak', 'run', GEARLEVER_APP_ID, '--integrate', appImagePath, '--yes'],
      60_000
    )
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }

  setUpdateSource(
    appImagePath: string,
    manager: UpdateManagerModel,
    params: Readonly<Record<string, string>>
  ): GearLeverCommandResult {
    const kvArgs = Object.entries(params).map(([k, v]) => `${k}=${v}`)
    const result = run(
      [
        'flatpak',
        'run',
        GEARLEVER_APP_ID,
        '--set-update-source',
        appImagePath,
        '--manager',
        manager,
        ...kvArgs
      ],
      30_000
    )
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }
}
