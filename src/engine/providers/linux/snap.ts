/**
 * 실제 snap 조회 — `SnapProvider`의 Linux 구현. 구 repo `probe_snap_list`
 * 행동 이식(`snap list` 출력 파싱).
 */
import type { SnapListRow, SnapProvider } from '../../capabilities/packages/providerTypes'
import { commandExists, run } from './exec'

export class LinuxSnapProvider implements SnapProvider {
  isAvailable(): boolean {
    return commandExists('snap')
  }

  async list(): Promise<SnapListRow[]> {
    if (!this.isAvailable()) return []
    const result = await run(['snap', 'list'])
    if (result.code !== 0) return []
    const lines = result.stdout.split('\n')
    if (lines.length < 2) return []

    const rows: SnapListRow[] = []
    for (const line of lines.slice(1)) {
      const parts = line.split(/\s+/).filter(Boolean)
      if (parts.length === 0) continue
      const name = parts[0]
      const notes = parts.length >= 6 ? parts[parts.length - 1] : '-'
      rows.push({ name, notes })
    }
    return rows
  }
}
