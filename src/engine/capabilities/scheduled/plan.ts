/**
 * scheduled(cron) plan — 구 repo `plan_cron`(rigsync.py:1640) 행동 이식.
 * `crontab` 명령은 사용자별이라 sudo가 필요 없다 — `privileged: false`, 테스트에서
 * `run()`이 실제로 호출되므로 라이브 조회/적용은 `CronProvider` 뒤로 격리한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import type { PlanAction } from '../../plan'
import { scheduledStorePath } from './store'
import type { CronProvider } from './providerTypes'
import type { ScheduledDiffReport } from './types'

export function planScheduled(
  ctx: RigsyncContext,
  provider: CronProvider,
  diff: ScheduledDiffReport,
  runTs: string
): PlanAction[] {
  if (diff.skipped || !diff.contentChanged) return []

  const storedPath = scheduledStorePath(ctx)
  return [
    {
      capability: 'scheduled',
      summary: 'restore crontab from manifest',
      commands: [`crontab ${storedPath}`],
      privileged: false,
      run: async () => {
        const live = provider.readCrontab()
        if (live !== null) {
          const backupPath = path.join(ctx.backupRoot, runTs, 'scheduled', 'crontab.txt')
          fs.mkdirSync(path.dirname(backupPath), { recursive: true })
          fs.writeFileSync(backupPath, live)
        }
        const storedContent = fs.readFileSync(storedPath, 'utf-8')
        const result = provider.writeCrontab(storedContent)
        return {
          ok: result.ok,
          detail: result.output || (result.ok ? 'crontab restored' : '복원 실패')
        }
      }
    }
  ]
}
