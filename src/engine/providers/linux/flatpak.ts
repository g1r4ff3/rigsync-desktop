/**
 * 실제 flatpak 조회+실행 — `FlatpakProvider`의 Linux 구현. 구 repo
 * `probe_flatpak_remotes`/`probe_flatpak_apps` 행동 이식. `addRemoteUser`/
 * `installAppUser`는 항상 `--user`를 붙인다(P2a 결정 ② — unprivileged 실행).
 */
import type {
  FlatpakAppRow,
  FlatpakCommandResult,
  FlatpakProvider,
  FlatpakRemoteRow
} from '../../capabilities/packages/providerTypes'
import { commandExists, run } from './exec'

export class LinuxFlatpakProvider implements FlatpakProvider {
  isAvailable(): boolean {
    return commandExists('flatpak')
  }

  remotes(): FlatpakRemoteRow[] {
    if (!this.isAvailable()) return []
    const result = run(['flatpak', 'remotes', '--columns=name,url'])
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

  apps(): FlatpakAppRow[] {
    if (!this.isAvailable()) return []
    const result = run(['flatpak', 'list', '--app', '--columns=application,origin,installation'])
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

  addRemoteUser(name: string, url: string): FlatpakCommandResult {
    const result = run(['flatpak', 'remote-add', '--user', '--if-not-exists', name, url], 120_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }

  installAppUser(origin: string, application: string): FlatpakCommandResult {
    const result = run(['flatpak', 'install', '--user', '-y', origin, application], 1_800_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }
}
