/**
 * 실제 systemd --user 유닛 조회+적용 — `SystemdUserProvider`의 Linux 구현. 구 repo
 * `probe_systemd_user_units`/`probe_systemctl_is_enabled`(rigsync.py:597-615)
 * 행동 이식.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  ServiceCommandResult,
  ServiceUnitFile,
  SystemdUserProvider
} from '../../capabilities/services/providerTypes'
import { run } from './exec'

function unitDir(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user')
}

export class LinuxSystemdUserProvider implements SystemdUserProvider {
  listUnitFiles(): ServiceUnitFile[] {
    const dir = unitDir()
    if (!fs.existsSync(dir)) return []
    const out: ServiceUnitFile[] = []
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      try {
        if (!fs.statSync(full).isFile()) continue
        out.push({ name, content: fs.readFileSync(full, 'utf-8') })
      } catch {
        // 읽기 실패 -- 이 파일만 건너뛴다.
      }
    }
    return out
  }

  readUnitFile(name: string): string | null {
    try {
      return fs.readFileSync(path.join(unitDir(), name), 'utf-8')
    } catch {
      return null
    }
  }

  isEnabled(name: string): boolean {
    const result = run(['systemctl', '--user', 'is-enabled', name])
    return result.code === 0
  }

  writeUnitFile(name: string, content: string): ServiceCommandResult {
    try {
      fs.mkdirSync(unitDir(), { recursive: true })
      fs.writeFileSync(path.join(unitDir(), name), content)
      return { ok: true, output: '' }
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : String(err) }
    }
  }

  daemonReload(): ServiceCommandResult {
    const result = run(['systemctl', '--user', 'daemon-reload'])
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }

  enable(name: string): ServiceCommandResult {
    const result = run(['systemctl', '--user', 'enable', name])
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }
}
