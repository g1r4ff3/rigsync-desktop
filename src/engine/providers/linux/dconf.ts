/**
 * 실제 dconf 조회+적용 — `DconfProvider`의 Linux 구현. 구 repo
 * `probe_dconf_dump`(rigsync.py:588) 행동 이식.
 */
import { spawnSync } from 'node:child_process'
import type { DconfCommandResult, DconfProvider } from '../../capabilities/settings/providerTypes'
import { commandExists, run } from './exec'

export class LinuxDconfProvider implements DconfProvider {
  isAvailable(): boolean {
    return commandExists('dconf')
  }

  dump(path: string): string {
    const result = run(['dconf', 'dump', path])
    return result.code === 0 ? result.stdout : ''
  }

  load(path: string, data: string): DconfCommandResult {
    const result = spawnSync('dconf', ['load', path], { input: data, encoding: 'utf-8' })
    if (result.error || result.status !== 0) {
      return { ok: false, output: (result.stdout ?? '') + (result.stderr ?? '') }
    }
    return { ok: true, output: '' }
  }
}
