/**
 * 실제 flatpak 조회+실행 — `FlatpakProvider`의 Linux 구현. 구 repo
 * `probe_flatpak_remotes`/`probe_flatpak_apps` 행동 이식. `addRemoteUser`/
 * `installAppUser`는 항상 `--user`를 붙인다(P2a 결정 ② — unprivileged 실행).
 *
 * P2c 결정 ④: 권한 오버라이드 파일 — user 설치 경로
 * (`~/.local/share/flatpak/overrides/`)만 다룬다(정책 §3.2, 이 repo는 --user
 * 전제라 system 오버라이드는 범위 밖).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  FlatpakAppDetail,
  FlatpakAppRow,
  FlatpakCommandResult,
  FlatpakOverrideFile,
  FlatpakProvider,
  FlatpakRemoteRow
} from '../../capabilities/packages/providerTypes'
import { commandExists, run } from './exec'

function overridesDir(): string {
  return path.join(os.homedir(), '.local', 'share', 'flatpak', 'overrides')
}

export class LinuxFlatpakProvider implements FlatpakProvider {
  isAvailable(): boolean {
    return commandExists('flatpak')
  }

  async remotes(): Promise<FlatpakRemoteRow[]> {
    if (!this.isAvailable()) return []
    const result = await run(['flatpak', 'remotes', '--columns=name,url'])
    if (result.code !== 0) return []
    const out: FlatpakRemoteRow[] = []
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      const parts = line.includes('\t') ? line.split('\t') : line.split(/\s+/)
      if (parts.length >= 2) out.push({ name: parts[0].trim(), url: parts[1].trim() })
      else if (parts.length === 1) out.push({ name: parts[0].trim(), url: '' })
    }
    return out
  }

  async apps(): Promise<FlatpakAppRow[]> {
    if (!this.isAvailable()) return []
    const result = await run([
      'flatpak',
      'list',
      '--app',
      '--columns=application,origin,installation'
    ])
    if (result.code !== 0) return []
    const out: FlatpakAppRow[] = []
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      let parts = line.split('\t')
      if (parts.length < 3) parts = line.split(/\s+/)
      if (parts.length >= 3) {
        out.push({
          application: parts[0].trim(),
          origin: parts[1].trim(),
          installation: parts[2].trim()
        })
      }
    }
    return out
  }

  async appDetails(): Promise<Readonly<Record<string, FlatpakAppDetail>>> {
    if (!this.isAvailable()) return {}
    const result = await run(['flatpak', 'list', '--app', '--columns=application,name,description'])
    if (result.code !== 0) return {}
    const out: Record<string, FlatpakAppDetail> = {}
    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      const parts = line.split('\t')
      if (parts.length < 3) continue
      out[parts[0].trim()] = { name: parts[1].trim(), description: parts[2].trim() }
    }
    return out
  }

  async addRemoteUser(name: string, url: string): Promise<FlatpakCommandResult> {
    const result = await run(
      ['flatpak', 'remote-add', '--user', '--if-not-exists', name, url],
      120_000
    )
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }

  async installAppUser(origin: string, application: string): Promise<FlatpakCommandResult> {
    const result = await run(['flatpak', 'install', '--user', '-y', origin, application], 1_800_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }

  async uninstallAppUser(application: string): Promise<FlatpakCommandResult> {
    const result = await run(['flatpak', 'uninstall', '--user', '-y', application], 300_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }

  listOverrideFiles(): FlatpakOverrideFile[] {
    const dir = overridesDir()
    if (!fs.existsSync(dir)) return []
    const out: FlatpakOverrideFile[] = []
    for (const appId of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, appId)
      try {
        if (!fs.statSync(full).isFile()) continue
        out.push({ appId, content: fs.readFileSync(full, 'utf-8') })
      } catch {
        // 읽기 실패 -- 이 파일만 건너뛴다.
      }
    }
    return out
  }

  overrideFileExists(appId: string): boolean {
    try {
      return fs.statSync(path.join(overridesDir(), appId)).isFile()
    } catch {
      return false
    }
  }

  readOverrideFileBytes(appId: string): Buffer | null {
    try {
      return fs.readFileSync(path.join(overridesDir(), appId))
    } catch {
      return null
    }
  }

  writeOverrideFile(appId: string, content: Buffer): FlatpakCommandResult {
    try {
      const dir = overridesDir()
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, appId), content)
      return { ok: true, output: '' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, output: message }
    }
  }
}
