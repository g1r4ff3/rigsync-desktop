/**
 * 실제 dconf 조회+적용 — `DconfProvider`의 Linux 구현. 구 repo
 * `probe_dconf_dump`(rigsync.py:588) 행동 이식.
 */
import type { DconfCommandResult, DconfProvider } from '../../capabilities/settings/providerTypes'
import { commandExists, run } from './exec'

export class LinuxDconfProvider implements DconfProvider {
  isAvailable(): boolean {
    return commandExists('dconf')
  }

  async dump(path: string): Promise<string> {
    const result = await run(['dconf', 'dump', path])
    return result.code === 0 ? result.stdout : ''
  }

  async load(path: string, data: string): Promise<DconfCommandResult> {
    const result = await run(['dconf', 'load', path], 20_000, data)
    if (result.code !== 0) {
      return { ok: false, output: result.stdout + result.stderr }
    }
    return { ok: true, output: '' }
  }
}
