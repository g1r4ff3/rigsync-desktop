/**
 * 실제 crontab 조회+적용 — `CronProvider`의 Linux 구현. 구 repo
 * `probe_crontab`(rigsync.py:616) 행동 이식: `crontab -l`이 0이 아닌 종료코드를
 * 내면(크론탭 없음 포함) null로 취급한다.
 */
import { spawnSync } from 'node:child_process'
import type { CronCommandResult, CronProvider } from '../../capabilities/scheduled/providerTypes'
import { commandExists, run } from './exec'

export class LinuxCronProvider implements CronProvider {
  isAvailable(): boolean {
    return commandExists('crontab')
  }

  readCrontab(): string | null {
    const result = run(['crontab', '-l'])
    if (result.code !== 0) return null
    return result.stdout
  }

  writeCrontab(content: string): CronCommandResult {
    const result = spawnSync('crontab', ['-'], { input: content, encoding: 'utf-8' })
    if (result.error || result.status !== 0) {
      return { ok: false, output: (result.stdout ?? '') + (result.stderr ?? '') }
    }
    return { ok: true, output: '' }
  }
}
